# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from odoo.tools import float_round
from datetime import datetime, timedelta
from dateutil.relativedelta import relativedelta
from collections import defaultdict


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

    # Items with PO
    items_with_po_count = fields.Integer(
        string='Items with Purchase Orders',
        compute='_compute_items_with_po'
    )

    # Monthly Release PO
    monthly_release_po_data = fields.Text(
        string='Monthly Release PO Data',
        compute='_compute_monthly_release_po'
    )

    # Monthly PO Values
    monthly_po_values_data = fields.Text(
        string='Monthly PO Values Data',
        compute='_compute_monthly_po_values'
    )

    # Total Inventory Cost
    total_inventory_cost = fields.Monetary(
        string='Total Inventory Cost',
        compute='_compute_total_inventory_cost',
        currency_field='currency_id'
    )

    # Not Moved Inventory
    inventory_not_moved_30 = fields.Integer(
        string='Not Moved (30 days)',
        compute='_compute_not_moved_inventory'
    )
    inventory_not_moved_45 = fields.Integer(
        string='Not Moved (45 days)',
        compute='_compute_not_moved_inventory'
    )
    inventory_not_moved_60 = fields.Integer(
        string='Not Moved (60 days)',
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

    # Consumption Cycle
    avg_consumption_cycle = fields.Float(
        string='Avg. Consumption Cycle (days)',
        compute='_compute_consumption_cycle'
    )
    consumption_cycle_data = fields.Text(
        string='Consumption Cycle Data',
        compute='_compute_consumption_cycle'
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
        """Calculate total spend for the year"""
        for record in self:
            # Get year start and end dates
            year_start = fields.Date.today().replace(month=1, day=1)
            year_end = fields.Date.today().replace(month=12, day=31)

            # Query purchase orders
            po_domain = [
                ('state', 'in', ['purchase', 'done']),
                ('company_id', '=', record.company_id.id),
                ('date_approve', '>=', year_start),
                ('date_approve', '<=', year_end)
            ]

            purchase_orders = self.env['purchase.order'].search(po_domain)

            total = sum(po.amount_total_cc for po in purchase_orders)
            record.total_spend_yearly = total

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_top_suppliers(self):
        """Get top 10 suppliers by spend"""
        for record in self:
            query = """
                SELECT 
                    po.partner_id,
                    rp.name,
                    SUM(po.amount_total_cc) as total_spend,
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

            # Store detailed data as JSON-like text
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
        """Count unique products with purchase orders"""
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
    def _compute_monthly_release_po(self):
        """Calculate monthly planned vs actual PO releases"""
        for record in self:
            query = """
                SELECT 
                    DATE_TRUNC('month', po.date_order) as month,
                    COUNT(CASE WHEN po.state = 'draft' THEN 1 END) as planned,
                    COUNT(CASE WHEN po.state IN ('purchase', 'done') THEN 1 END) as released
                FROM purchase_order po
                WHERE po.company_id = %s
                    AND po.date_order >= %s
                    AND po.date_order <= %s
                GROUP BY DATE_TRUNC('month', po.date_order)
                ORDER BY month
            """

            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))

            results = self.env.cr.fetchall()

            monthly_data = []
            for month, planned, released in results:
                monthly_data.append({
                    'month': month.strftime('%Y-%m') if month else '',
                    'planned': planned or 0,
                    'released': released or 0
                })
            record.monthly_release_po_data = str(monthly_data)

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_monthly_po_values(self):
        """Calculate monthly planned vs actual PO values"""
        for record in self:
            query = """
                SELECT 
                    DATE_TRUNC('month', po.date_order) as month,
                    SUM(CASE WHEN po.state = 'draft' THEN po.amount_total_cc ELSE 0 END) as planned_value,
                    SUM(CASE WHEN po.state IN ('purchase', 'done') THEN po.amount_total_cc ELSE 0 END) as actual_value
                FROM purchase_order po
                WHERE po.company_id = %s
                    AND po.date_order >= %s
                    AND po.date_order <= %s
                GROUP BY DATE_TRUNC('month', po.date_order)
                ORDER BY month
            """

            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))

            results = self.env.cr.fetchall()

            monthly_data = []
            for month, planned_value, actual_value in results:
                monthly_data.append({
                    'month': month.strftime('%Y-%m') if month else '',
                    'planned_value': planned_value or 0,
                    'actual_value': actual_value or 0
                })
            record.monthly_po_values_data = str(monthly_data)

    @api.depends('company_id')
    def _compute_total_inventory_cost(self):
        """Calculate total inventory cost"""
        for record in self:
            # Get all stock quants with quantity > 0
            quants = self.env['stock.quant'].search([
                ('company_id', '=', record.company_id.id),
                ('quantity', '>', 0),
                ('location_id.usage', '=', 'internal')
            ])

            total_cost = sum(
                quant.quantity * quant.product_id.standard_price
                for quant in quants
            )
            record.total_inventory_cost = total_cost

    @api.depends('company_id')
    def _compute_not_moved_inventory(self):
        """Calculate inventory not moved for 30, 45, 60 days"""
        for record in self:
            today = fields.Date.today()

            # Get products with their last movement date
            query = """
                SELECT 
                    sq.product_id,
                    pp.default_code,
                    pt.name,
                    MAX(sm.date) as last_move_date,
                    SUM(sq.quantity) as qty,
                    pp.standard_price
                FROM stock_quant sq
                JOIN product_product pp ON sq.product_id = pp.id
                JOIN product_template pt ON pp.product_tmpl_id = pt.id
                LEFT JOIN stock_move sm ON sm.product_id = sq.product_id
                WHERE sq.company_id = %s
                    AND sq.quantity > 0
                    AND sq.location_id IN (
                        SELECT id FROM stock_location WHERE usage = 'internal'
                    )
                GROUP BY sq.product_id, pp.default_code, pt.name, pp.standard_price
                HAVING MAX(sm.date) IS NOT NULL
            """

            self.env.cr.execute(query, (record.company_id.id,))
            results = self.env.cr.fetchall()

            count_30 = 0
            count_45 = 0
            count_60 = 0
            inventory_data = []

            for product_id, code, name, last_move, qty, price in results:
                if not last_move:
                    continue

                days_not_moved = (today - last_move.date()).days

                if days_not_moved >= 60:
                    count_60 += 1
                    inventory_data.append({
                        'product_id': product_id,
                        'code': code,
                        'name': name,
                        'days_not_moved': days_not_moved,
                        'qty': qty,
                        'value': qty * price
                    })
                elif days_not_moved >= 45:
                    count_45 += 1
                elif days_not_moved >= 30:
                    count_30 += 1

            record.inventory_not_moved_30 = count_30
            record.inventory_not_moved_45 = count_45
            record.inventory_not_moved_60 = count_60
            record.inventory_not_moved_data = str(inventory_data)

    @api.depends('company_id')
    def _compute_new_vendors(self):
        """Count vendors created in current month"""
        for record in self:
            month_start = fields.Date.today().replace(day=1)

            new_vendors = self.env['res.partner'].search([
                ('supplier_rank', '>', 0),
                ('company_id', 'in', [False, record.company_id.id]),
                ('create_date', '>=', month_start)
            ])

            record.new_vendors_count = len(new_vendors)
            record.new_vendor_ids = [(6, 0, new_vendors.ids)]

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_consumption_cycle(self):
        """Calculate average consumption cycle (days between PO and receipt)"""
        for record in self:
            query = """
                SELECT 
                    pp.id,
                    pt.name,
                    AVG(EXTRACT(epoch FROM (sm.date - po.date_order))/86400) as avg_days
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
            """

            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))

            results = self.env.cr.fetchall()

            if results:
                total_avg = sum(r[2] for r in results if r[2]) / len(results)
                record.avg_consumption_cycle = total_avg

                cycle_data = []
                for product_id, name, avg_days in results:
                    if avg_days:
                        cycle_data.append({
                            'product_id': product_id,
                            'product_name': name,
                            'avg_days': round(avg_days, 2)
                        })
                record.consumption_cycle_data = str(cycle_data)
            else:
                record.avg_consumption_cycle = 0.0
                record.consumption_cycle_data = '[]'

    @api.depends('date_from', 'date_to', 'company_id')
    def _compute_department_consumption(self):
        """Calculate department-wise consumption (using analytic accounts as departments)"""
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
        """Calculate spend by product category (commodity)"""
        for record in self:
            query = """
                SELECT 
                    pc.complete_name as category,
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
                GROUP BY pc.complete_name
                ORDER BY total_spend DESC
            """

            self.env.cr.execute(query, (
                record.company_id.id,
                record.date_from,
                record.date_to
            ))

            results = self.env.cr.fetchall()

            commodity_data = []
            for category, total_spend, product_count, po_count in results:
                commodity_data.append({
                    'category': category or 'Uncategorized',
                    'total_spend': total_spend,
                    'product_count': product_count,
                    'po_count': po_count
                })
            record.commodity_spend_data = str(commodity_data)

    def action_refresh_dashboard(self):
        """Manual refresh action for dashboard"""
        self.ensure_one()
        # Force recomputation of all computed fields
        self._compute_total_spend_yearly()
        self._compute_top_suppliers()
        self._compute_items_with_po()
        self._compute_monthly_release_po()
        self._compute_monthly_po_values()
        self._compute_total_inventory_cost()
        self._compute_not_moved_inventory()
        self._compute_new_vendors()
        self._compute_consumption_cycle()
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
        """Open view of top suppliers"""
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
        """Open view of not moved inventory based on selected days"""
        self.ensure_one()
        # This would need to be implemented based on the selection button clicked
        return {
            'name': _('Not Moved Inventory'),
            'type': 'ir.actions.act_window',
            'res_model': 'product.product',
            'view_mode': 'tree,form',
            'context': {'create': False}
        }

    def action_view_new_vendors(self):
        """Open view of new vendors"""
        self.ensure_one()
        return {
            'name': _('New Vendors'),
            'type': 'ir.actions.act_window',
            'res_model': 'res.partner',
            'view_mode': 'tree,form',
            'domain': [('id', 'in', self.new_vendor_ids.ids)],
            'context': {'create': False}
        }