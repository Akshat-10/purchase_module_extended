# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.tools import float_round
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from collections import defaultdict

import logging
_logger = logging.getLogger(__name__)


class PurchaseDashboard(models.Model):
    _name = 'purchase.dashboard'
    _description = 'Purchase Analytics Dashboard'
    _rec_name = 'name'

    name = fields.Char(string='Dashboard Name', required=True, default='Purchase Dashboard')
    company_id = fields.Many2one('res.company', string='Company', default=lambda self: self.env.company)
    date_from = fields.Date(string='Date From', default=lambda self: fields.Date.today().replace(month=1, day=1))
    date_to = fields.Date(string='Date To', default=fields.Date.today)

    # Total Spend (Yearly)
    total_spend_yearly = fields.Monetary(
        string='Total Spend (Yearly)',
        compute='_compute_total_spend_yearly',
        currency_field='currency_id'
    )

    # Top Suppliers
    top_supplier_ids = fields.Many2many(
        'res.partner',
        string='Top Suppliers',
        compute='_compute_top_suppliers'
    )
    top_supplier_data = fields.Text(string='Top Supplier Data', compute='_compute_top_suppliers')

    # FIX: Items with PO - count distinct products in PO lines
    items_with_po_count = fields.Integer(
        string='Items with Purchase Orders',
        compute='_compute_items_with_po'
    )

    # Monthly PO Summary
    monthly_po_summary_data = fields.Text(
        string='Monthly PO Summary Data',
        compute='_compute_monthly_po_summary'
    )

    # Total Inventory Cost
    total_inventory_cost = fields.Monetary(
        string='Total Inventory Cost',
        compute='_compute_total_inventory_cost',
        currency_field='currency_id'
    )

    # Not Moved Inventory
    inventory_not_moved_30 = fields.Integer(
        string='Not Moved (30+ days)',
        compute='_compute_not_moved_inventory'
    )
    inventory_not_moved_45 = fields.Integer(
        string='Not Moved (45+ days)',
        compute='_compute_not_moved_inventory'
    )
    inventory_not_moved_60 = fields.Integer(
        string='Not Moved (60+ days)',
        compute='_compute_not_moved_inventory'
    )
    inventory_not_moved_data = fields.Text(
        string='Not Moved Inventory Data',
        compute='_compute_not_moved_inventory'
    )

    # New Vendors
    new_vendors_count = fields.Integer(
        string='New Vendors This Month',
        compute='_compute_new_vendors'
    )
    new_vendor_ids = fields.Many2many(
        'res.partner',
        'purchase_dashboard_new_vendor_rel',
        string='New Vendors',
        compute='_compute_new_vendors'
    )

    avg_po_to_receipt = fields.Float(
        string='Avg. PO to Receipt (days)',
        compute='_compute_po_to_receipt'
    )
    po_to_receipt_data = fields.Text(
        string='PO to Receipt Data',
        compute='_compute_po_to_receipt'
    )

    # Department-wise Consumption
    department_consumption_data = fields.Text(
        string='Department-wise Consumption',
        compute='_compute_department_consumption'
    )

    # Spend by Commodity/Category
    commodity_spend_data = fields.Text(
        string='Spend by Commodity',
        compute='_compute_commodity_spend'
    )

    currency_id = fields.Many2one(
        'res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id
    )

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_total_spend_yearly(self):
        """Calculate total spend for confirmed POs in date range"""
        for record in self:
            po_domain = [
                ('state', 'in', ['purchase', 'done']),
                ('company_id', '=', record.company_id.id),
                ('date_approve', '>=', record.date_from),
                ('date_approve', '<=', record.date_to),
            ]
            purchase_orders = self.env['purchase.order'].search(po_domain)
            record.total_spend_yearly = sum(po.amount_total for po in purchase_orders)

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_top_suppliers(self):
        """Get top 10 suppliers by spend"""
        for record in self:
            query = """
                SELECT 
                    po.partner_id,
                    rp.name,
                    SUM(po.amount_total) as total_spend,
                    COUNT(po.id) as po_count
                FROM purchase_order po
                JOIN res_partner rp ON po.partner_id = rp.id
                WHERE po.state IN ('purchase', 'done')
                    AND po.company_id = %s
                    AND po.date_approve >= %s
                    AND po.date_approve <= %s
                GROUP BY po.partner_id, rp.name
                ORDER BY total_spend DESC
                LIMIT 10
            """
            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))
            results = self.env.cr.fetchall()
            supplier_ids = [r[0] for r in results]
            record.top_supplier_ids = [(6, 0, supplier_ids)]
            supplier_data = []
            for partner_id, name, total_spend, po_count in results:
                supplier_data.append({
                    'partner_id': partner_id,
                    'name': name,
                    'total_spend': total_spend,
                    'po_count': po_count
                })
            record.top_supplier_data = str(supplier_data)

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_items_with_po(self):
        """
        FIX: Count unique products that have confirmed PO lines in date range.
        Previously this was counting ALL active products — now correctly counts
        only products appearing in purchase orders within the selected date range.
        """
        for record in self:
            query = """
                SELECT COUNT(DISTINCT pol.product_id)
                FROM purchase_order_line pol
                JOIN purchase_order po ON pol.order_id = po.id
                WHERE po.state IN ('purchase', 'done')
                    AND po.company_id = %s
                    AND po.date_approve >= %s
                    AND po.date_approve <= %s
                    AND pol.product_id IS NOT NULL
                    AND pol.display_type IS NULL
            """
            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))
            result = self.env.cr.fetchone()
            record.items_with_po_count = result[0] if result else 0

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_monthly_po_summary(self):
        """
        FIX: Monthly PO count + value.
        Now includes 'to approve' and 'sent' states in released/planned counts.
        States:
          - draft → RFQ (planned)
          - sent  → RFQ Sent (planned)
          - to approve → waiting approval (counted as released for ops visibility)
          - purchase, done → confirmed PO (released/actual)
        """
        for record in self:
            query = """
                SELECT 
                    TO_CHAR(DATE_TRUNC('month', po.date_order), 'YYYY-MM') AS month,
                    po.state,
                    COUNT(*) AS po_count,
                    COALESCE(SUM(po.amount_total), 0) AS po_value
                FROM purchase_order po
                WHERE po.company_id = %s
                    AND po.date_order >= %s
                    AND po.date_order <= %s
                GROUP BY DATE_TRUNC('month', po.date_order), po.state
                ORDER BY month
            """
            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))
            results = self.env.cr.fetchall()
            monthly_dict = {}

            for month, state, count, value in results:
                if month not in monthly_dict:
                    monthly_dict[month] = {
                        'month': month,
                        'planned_count': 0,
                        'planned_value': 0,
                        'released_count': 0,
                        'actual_value': 0,
                        'to_approve_count': 0,
                        'to_approve_value': 0,
                    }

                if state in ('draft', 'sent'):
                    # RFQ and RFQ Sent = planned
                    monthly_dict[month]['planned_count'] += count
                    monthly_dict[month]['planned_value'] += value
                elif state == 'to approve':
                    # Waiting approval — show separately
                    monthly_dict[month]['to_approve_count'] += count
                    monthly_dict[month]['to_approve_value'] += value
                    # Also count in released for chart (manager approval pending but ops confirmed)
                    monthly_dict[month]['released_count'] += count
                    monthly_dict[month]['actual_value'] += value
                elif state in ('purchase', 'done'):
                    monthly_dict[month]['released_count'] += count
                    monthly_dict[month]['actual_value'] += value

            monthly_data = []
            currency = record.company_id.currency_id.symbol

            for data in sorted(monthly_dict.values(), key=lambda x: x['month']):
                monthly_data.append({
                    'month': data['month'],
                    'planned_count': data['planned_count'],
                    'planned_value': data['planned_value'],
                    'released_count': data['released_count'],
                    'actual_value': data['actual_value'],
                    'to_approve_count': data['to_approve_count'],
                    'to_approve_value': data['to_approve_value'],
                    'planned_display': f"{data['planned_count']} ({currency} {data['planned_value']:,.2f})",
                    'released_display': f"{data['released_count']} ({currency} {data['actual_value']:,.2f})",
                })

            record.monthly_po_summary_data = str(monthly_data)

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_total_inventory_cost(self):
        """
        FIX: Use stock.quant value field directly.
        Odoo maintains the 'value' field on stock.quant using actual cost (AVCO/FIFO/Standard).
        Do NOT use standard_price * quantity as it may differ from actual valuation.
        """
        for record in self:
            query = """
                SELECT 
                    COALESCE(SUM(sq.value), 0) as total_value,
                    COUNT(DISTINCT sq.product_id) as product_count,
                    SUM(sq.quantity) as total_qty
                FROM stock_quant sq
                JOIN stock_location sl ON sq.location_id = sl.id
                WHERE sq.company_id = %s
                    AND sq.quantity > 0
                    AND sl.usage = 'internal'
            """
            try:
                self.env.cr.execute(query, (record.company_id.id,))
                result = self.env.cr.fetchone()
                if result and result[0]:
                    record.total_inventory_cost = result[0]
                    _logger.info("Total inventory cost: %.2f (products: %s, qty: %.2f)",
                                 result[0], result[1], result[2] or 0)
                else:
                    record.total_inventory_cost = 0
                    _logger.warning("Inventory cost is zero — check stock.quant records for company %s",
                                    record.company_id.name)
            except Exception as e:
                _logger.error("Error calculating inventory cost: %s", e, exc_info=True)
                record.total_inventory_cost = 0

    @api.depends('company_id')
    def _compute_not_moved_inventory(self):
        """
        FIX: Corrected bucket logic.
        - notMoved30 = products not consumed for 30+ days (INCLUDES 45+ and 60+)
        - notMoved45 = products not consumed for 45+ days (INCLUDES 60+)
        - notMoved60 = products not consumed for 60+ days
        Previously buckets were mutually exclusive which gave misleading totals.
        """
        for record in self:
            today = fields.Date.today()

            query = """
                SELECT 
                    sq.product_id,
                    pp.default_code,
                    pt.name,
                    MAX(sm.date) as last_move_date,
                    SUM(sq.quantity) as qty,
                    COALESCE(SUM(sq.value), 0) as total_value
                FROM stock_quant sq
                JOIN product_product pp ON sq.product_id = pp.id
                JOIN product_template pt ON pp.product_tmpl_id = pt.id
                LEFT JOIN stock_move sm ON sm.product_id = sq.product_id
                    AND sm.state = 'done'
                    AND sm.company_id = %s
                    AND sm.location_id IN (
                        SELECT id FROM stock_location WHERE usage = 'internal'
                    )
                    AND sm.location_dest_id NOT IN (
                        SELECT id FROM stock_location WHERE usage = 'internal'
                    )
                WHERE sq.company_id = %s
                    AND sq.quantity > 0
                    AND sq.location_id IN (
                        SELECT id FROM stock_location WHERE usage = 'internal'
                    )
                GROUP BY sq.product_id, pp.default_code, pt.name
            """

            self.env.cr.execute(query, (record.company_id.id, record.company_id.id))
            results = self.env.cr.fetchall()

            # FIX: Cumulative buckets (30+ includes 45+ and 60+)
            count_30 = 0  # 30+ days (all slow moving)
            count_45 = 0  # 45+ days
            count_60 = 0  # 60+ days
            inventory_data = []

            for product_id, code, name, last_move, qty, value in results:
                if not last_move:
                    days_not_moved = 999
                else:
                    days_not_moved = (today - last_move.date()).days

                if days_not_moved >= 60:
                    count_30 += 1
                    count_45 += 1
                    count_60 += 1
                    inventory_data.append({
                        'product_id': product_id,
                        'code': code,
                        'name': name,
                        'days_not_moved': days_not_moved,
                        'qty': qty,
                        'value': value
                    })
                elif days_not_moved >= 45:
                    count_30 += 1
                    count_45 += 1
                    inventory_data.append({
                        'product_id': product_id,
                        'code': code,
                        'name': name,
                        'days_not_moved': days_not_moved,
                        'qty': qty,
                        'value': value
                    })
                elif days_not_moved >= 30:
                    count_30 += 1
                    inventory_data.append({
                        'product_id': product_id,
                        'code': code,
                        'name': name,
                        'days_not_moved': days_not_moved,
                        'qty': qty,
                        'value': value
                    })

            record.inventory_not_moved_30 = count_30
            record.inventory_not_moved_45 = count_45
            record.inventory_not_moved_60 = count_60
            record.inventory_not_moved_data = str(inventory_data)

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_new_vendors(self):
        """
        FIX: Added company filter. Uses date_from/date_to range, not hardcoded month.
        """
        for record in self:
            new_vendors = self.env['res.partner'].search([
                ('supplier_rank', '>', 0),
                ('company_id', 'in', [False, record.company_id.id]),
                ('create_date', '>=', record.date_from),
                ('create_date', '<=', record.date_to),
            ])
            record.new_vendors_count = len(new_vendors)
            record.new_vendor_ids = [(6, 0, new_vendors.ids)]

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_po_to_receipt(self):
        """
        Calculate average time from PO confirmation to goods receipt.
        Uses date_approve on PO and actual done date on stock.move.
        """
        for record in self:
            query = """
                SELECT 
                    pp.id,
                    pt.name,
                    AVG(EXTRACT(epoch FROM (sm.date - po.date_approve))/86400) as avg_days,
                    COUNT(sm.id) as move_count,
                    COUNT(DISTINCT po.id) as po_count
                FROM purchase_order_line pol
                JOIN purchase_order po ON pol.order_id = po.id
                JOIN product_product pp ON pol.product_id = pp.id
                JOIN product_template pt ON pp.product_tmpl_id = pt.id
                LEFT JOIN stock_move sm ON sm.purchase_line_id = pol.id
                    AND sm.state = 'done'
                WHERE po.state IN ('purchase', 'done')
                    AND po.company_id = %s
                    AND po.date_approve >= %s
                    AND po.date_approve <= %s
                    AND pol.product_id IS NOT NULL
                GROUP BY pp.id, pt.name
                HAVING COUNT(sm.id) > 0
                ORDER BY avg_days DESC
            """
            try:
                self.env.cr.execute(query, (
                    record.company_id.id,
                    record.date_from,
                    record.date_to
                ))
                results = self.env.cr.fetchall()
                if results:
                    valid_results = [r for r in results if r[2] is not None and r[2] > 0]
                    if valid_results:
                        record.avg_po_to_receipt = sum(r[2] for r in valid_results) / len(valid_results)
                        cycle_data = []
                        for product_id, name, avg_days, move_count, po_count in results:
                            if avg_days:
                                cycle_data.append({
                                    'product_id': product_id,
                                    'product_name': name,
                                    'avg_days': round(avg_days, 2),
                                    'move_count': move_count,
                                    'po_count': po_count
                                })
                        record.po_to_receipt_data = str(cycle_data)
                    else:
                        record.avg_po_to_receipt = 0.0
                        record.po_to_receipt_data = '[]'
                else:
                    record.avg_po_to_receipt = 0.0
                    record.po_to_receipt_data = '[]'
            except Exception as e:
                _logger.error("Error in _compute_po_to_receipt: %s", e, exc_info=True)
                record.avg_po_to_receipt = 0.0
                record.po_to_receipt_data = '[]'

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_department_consumption(self):
        """Calculate department-wise consumption using analytic accounts"""
        for record in self:
            query = """
                SELECT 
                    aa.name as department,
                    SUM(pol.price_subtotal) as total_spend,
                    COUNT(DISTINCT pol.product_id) as product_count
                FROM purchase_order_line pol
                JOIN purchase_order po ON pol.order_id = po.id
                CROSS JOIN LATERAL jsonb_each_text(pol.analytic_distribution::jsonb) as ad(account_id, percentage)
                JOIN account_analytic_account aa ON aa.id = ad.account_id::integer
                WHERE po.state IN ('purchase', 'done')
                    AND po.company_id = %s
                    AND po.date_approve >= %s
                    AND po.date_approve <= %s
                    AND pol.analytic_distribution IS NOT NULL
                GROUP BY aa.name
                ORDER BY total_spend DESC
            """
            try:
                self.env.cr.execute(query, (
                    record.company_id.id,
                    record.date_from,
                    record.date_to
                ))
                results = self.env.cr.fetchall()
                dept_data = []
                for dept_name, total_spend, product_count in results:
                    dept_data.append({
                        'department': dept_name,
                        'total_spend': total_spend,
                        'product_count': product_count
                    })
                record.department_consumption_data = str(dept_data)
            except Exception:
                record.department_consumption_data = '[]'

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_commodity_spend(self):
        """
        FIX: Use SQL aggregation instead of Python loop.
        Previously only sampled 20 PO lines — now aggregates ALL lines correctly.
        """
        for record in self:
            query = """
                SELECT 
                    pc.complete_name as category,
                    pc.id as category_id,
                    SUM(pol.price_subtotal) as total_spend,
                    COUNT(DISTINCT pol.product_id) as product_count,
                    COUNT(DISTINCT po.id) as po_count
                FROM purchase_order_line pol
                JOIN purchase_order po ON pol.order_id = po.id
                JOIN product_product pp ON pol.product_id = pp.id
                JOIN product_template pt ON pp.product_tmpl_id = pt.id
                LEFT JOIN product_category pc ON pt.categ_id = pc.id
                WHERE po.state IN ('purchase', 'done')
                    AND po.company_id = %s
                    AND po.date_approve >= %s
                    AND po.date_approve <= %s
                    AND pol.product_id IS NOT NULL
                    AND pol.display_type IS NULL
                GROUP BY pc.complete_name, pc.id
                ORDER BY total_spend DESC
            """
            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))
            results = self.env.cr.fetchall()
            commodity_data = []
            for category, category_id, total_spend, product_count, po_count in results:
                commodity_data.append({
                    'category': category or 'Uncategorized',
                    'category_id': category_id,
                    'total_spend': total_spend,
                    'product_count': product_count,
                    'po_count': po_count
                })
            record.commodity_spend_data = str(commodity_data)

    def action_refresh_dashboard(self):
        """Manual refresh action for dashboard"""
        self.ensure_one()
        self._compute_total_spend_yearly()
        self._compute_top_suppliers()
        self._compute_items_with_po()
        self._compute_monthly_po_summary()
        self._compute_total_inventory_cost()
        self._compute_not_moved_inventory()
        self._compute_new_vendors()
        self._compute_po_to_receipt()
        self._compute_department_consumption()
        self._compute_commodity_spend()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'message': _('Dashboard refreshed successfully'),
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }

    def action_view_top_suppliers(self):
        self.ensure_one()
        return {
            'name': _('Top Suppliers'),
            'type': 'ir.actions.act_window',
            'res_model': 'res.partner',
            'view_mode': 'tree,form',
            'domain': [('id', 'in', self.top_supplier_ids.ids)],
            'context': {'create': False}
        }

    def action_view_not_moved_inventory(self):
        self.ensure_one()
        return {
            'name': _('Not Moved Inventory'),
            'type': 'ir.actions.act_window',
            'res_model': 'product.product',
            'view_mode': 'tree,form',
            'context': {'create': False}
        }

    def action_view_new_vendors(self):
        self.ensure_one()
        return {
            'name': _('New Vendors'),
            'type': 'ir.actions.act_window',
            'res_model': 'res.partner',
            'view_mode': 'tree,form',
            'domain': [('id', 'in', self.new_vendor_ids.ids)],
            'context': {'create': False}
        }