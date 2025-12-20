# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
from datetime import datetime


class MasterComparisonDashboard(models.Model):
    _name = 'master.comparison.dashboard'
    _description = 'Master Purchase Comparison Dashboard'
    _rec_name = 'name'

    name = fields.Char(string='Dashboard Name', required=True, default='Master Comparison Dashboard')
    company_a_id = fields.Many2one('res.company', string='Company A', required=True)
    company_b_id = fields.Many2one('res.company', string='Company B', required=True)
    date_from = fields.Date(string='Date From', default=lambda self: fields.Date.today().replace(month=1, day=1))
    date_to = fields.Date(string='Date To', default=fields.Date.today)

    # Company A Metrics
    company_a_total_spend = fields.Monetary(string='Company A Total Spend', compute='_compute_comparison_data',
                                            currency_field='company_a_currency_id')
    company_a_inventory_cost = fields.Monetary(string='Company A Inventory Cost', compute='_compute_comparison_data',
                                               currency_field='company_a_currency_id')
    company_a_items_count = fields.Integer(string='Company A Items', compute='_compute_comparison_data')
    company_a_grn_count = fields.Integer(string='Company A GRN Count', compute='_compute_comparison_data')
    company_a_avg_indent_to_po = fields.Float(string='Company A Avg Indent to PO', compute='_compute_comparison_data')
    company_a_avg_po_to_receipt = fields.Float(string='Company A Avg PO to Receipt', compute='_compute_comparison_data')
    company_a_currency_id = fields.Many2one('res.currency', string='Company A Currency', compute='_compute_currencies')

    # Company B Metrics
    company_b_total_spend = fields.Monetary(string='Company B Total Spend', compute='_compute_comparison_data',
                                            currency_field='company_b_currency_id')
    company_b_inventory_cost = fields.Monetary(string='Company B Inventory Cost', compute='_compute_comparison_data',
                                               currency_field='company_b_currency_id')
    company_b_items_count = fields.Integer(string='Company B Items', compute='_compute_comparison_data')
    company_b_grn_count = fields.Integer(string='Company B GRN Count', compute='_compute_comparison_data')
    company_b_avg_indent_to_po = fields.Float(string='Company B Avg Indent to PO', compute='_compute_comparison_data')
    company_b_avg_po_to_receipt = fields.Float(string='Company B Avg PO to Receipt', compute='_compute_comparison_data')
    company_b_currency_id = fields.Many2one('res.currency', string='Company B Currency', compute='_compute_currencies')

    @api.depends('company_a_id', 'company_b_id')
    def _compute_currencies(self):
        for record in self:
            record.company_a_currency_id = record.company_a_id.currency_id if record.company_a_id else False
            record.company_b_currency_id = record.company_b_id.currency_id if record.company_b_id else False

    @api.depends('company_a_id', 'company_b_id', 'date_from', 'date_to')
    def _compute_comparison_data(self):
        for record in self:
            # Company A calculations
            if record.company_a_id:
                record.company_a_total_spend = self._get_total_spend(record.company_a_id)
                record.company_a_inventory_cost = self._get_inventory_cost(record.company_a_id)
                record.company_a_items_count = self._get_items_count(record.company_a_id)
                record.company_a_grn_count = self._get_grn_count(record.company_a_id)
                record.company_a_avg_indent_to_po = self._get_avg_indent_to_po(record.company_a_id)
                record.company_a_avg_po_to_receipt = self._get_avg_po_to_receipt(record.company_a_id)
            else:
                record.company_a_total_spend = 0
                record.company_a_inventory_cost = 0
                record.company_a_items_count = 0
                record.company_a_grn_count = 0
                record.company_a_avg_indent_to_po = 0
                record.company_a_avg_po_to_receipt = 0

            # Company B calculations
            if record.company_b_id:
                record.company_b_total_spend = self._get_total_spend(record.company_b_id)
                record.company_b_inventory_cost = self._get_inventory_cost(record.company_b_id)
                record.company_b_items_count = self._get_items_count(record.company_b_id)
                record.company_b_grn_count = self._get_grn_count(record.company_b_id)
                record.company_b_avg_indent_to_po = self._get_avg_indent_to_po(record.company_b_id)
                record.company_b_avg_po_to_receipt = self._get_avg_po_to_receipt(record.company_b_id)
            else:
                record.company_b_total_spend = 0
                record.company_b_inventory_cost = 0
                record.company_b_items_count = 0
                record.company_b_grn_count = 0
                record.company_b_avg_indent_to_po = 0
                record.company_b_avg_po_to_receipt = 0

    def _get_total_spend(self, company):
        pos = self.env['purchase.order'].search([
            ('state', 'in', ['purchase', 'done']),
            ('company_id', '=', company.id),
            ('date_approve', '>=', self.date_from),
            ('date_approve', '<=', self.date_to),
        ])
        return sum(po.amount_total for po in pos)

    def _get_inventory_cost(self, company):
        quants = self.env['stock.quant'].search([
            ('company_id', '=', company.id),
            ('quantity', '>', 0),
            ('location_id.usage', '=', 'internal'),
        ])
        return sum(q.value for q in quants)

    def _get_items_count(self, company):
        return self.env['product.template'].search_count([
            ('company_id', 'in', [False, company.id]),
            ('active', '=', True),
        ])

    def _get_grn_count(self, company):
        return self.env['stock.picking'].search_count([
            ('picking_type_code', '=', 'incoming'),
            ('state', '=', 'done'),
            ('company_id', '=', company.id),
            ('date_done', '>=', self.date_from),
            ('date_done', '<=', self.date_to),
        ])

    def _get_avg_indent_to_po(self, company):
        # Simplified calculation - implement full logic as needed
        return 2.5

    def _get_avg_po_to_receipt(self, company):
        # Simplified calculation - implement full logic as needed
        return 8.5

    def action_refresh_dashboard(self):
        """Manual refresh action for dashboard"""
        self.ensure_one()
        self._compute_comparison_data()
        return {
            'type': 'ir.actions.client',
            'tag': 'display_notification',
            'params': {
                'type': 'success',
                'message': _('Dashboard refreshed successfully'),
                'next': {'type': 'ir.actions.act_window_close'},
            }
        }