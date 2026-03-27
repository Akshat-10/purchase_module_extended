# -*- coding: utf-8 -*-
from odoo import api, fields, models, _
import re

class PurchaseTarget(models.Model):
    _name = 'purchase.target'
    _description = 'Monthly Purchase Target'
    _rec_name = 'month_display'

    month = fields.Char(
        string='Month (YYYY-MM)',
        required=True,
        help='Format: YYYY-MM (e.g., 2026-01)'
    )
    month_display = fields.Char(
        string='Month',
        compute='_compute_month_display',
        store=True
    )
    target_value = fields.Monetary(
        string='Target Value',
        required=True,
        currency_field='currency_id'
    )
    company_id = fields.Many2one(
        'res.company',
        string='Company',
        default=lambda self: self.env.company
    )
    currency_id = fields.Many2one(
        'res.currency',
        string='Currency',
        default=lambda self: self.env.company.currency_id
    )
    notes = fields.Text(string='Notes')
    created_on = fields.Datetime(
        string='Created On',
        default=fields.Datetime.now,
        readonly=True
    )

    _sql_constraints = [
        ('month_company_unique', 'unique(month, company_id)',
         'Target for this month and company already exists!')
    ]

    @api.depends('month')
    def _compute_month_display(self):
        month_names = {
            '01': 'January', '02': 'February', '03': 'March',
            '04': 'April', '05': 'May', '06': 'June',
            '07': 'July', '08': 'August', '09': 'September',
            '10': 'October', '11': 'November', '12': 'December'
        }
        for rec in self:
            if rec.month and re.match(r'^\d{4}-\d{2}$', rec.month):
                year, mon = rec.month.split('-')
                rec.month_display = f"{month_names.get(mon, mon)} {year}"
            else:
                rec.month_display = rec.month or ''

    @api.constrains('month')
    def _check_month_format(self):
        for rec in self:
            if rec.month and not re.match(r'^\d{4}-\d{2}$', rec.month):
                raise ValueError('Month must be in YYYY-MM format (e.g., 2026-01)')

    @api.model
    def get_all_targets(self):
        """Always returns YYYY-MM keys"""
        targets = self.search([('company_id', '=', self.env.company.id)])
        return {target.month: target.target_value for target in targets}

    @api.model
    def set_target(self, month, value):
        try:
            month = self._normalize_month_key(month)
            existing = self.search([
                ('month', '=', month),
                ('company_id', '=', self.env.company.id)
            ])
            if existing:
                existing.write({'target_value': float(value or 0)})
            else:
                self.create({
                    'month': month,
                    'target_value': float(value or 0),
                    'company_id': self.env.company.id
                })
            return {'success': True, 'message': _('Target saved successfully')}
        except Exception as e:
            return {'success': False, 'message': str(e)}

    @api.model
    def _normalize_month_key(self, month):
        if not month:
            return ''
        if re.match(r'^\d{4}-\d{2}$', month):
            return month
        month_names = {
            'january': '01', 'february': '02', 'march': '03', 'april': '04',
            'may': '05', 'june': '06', 'july': '07', 'august': '08',
            'september': '09', 'october': '10', 'november': '11', 'december': '12'
        }
        match = re.match(r'^([A-Za-z]+)\s+(\d{4})$', month)
        if match:
            mon_num = month_names.get(match.group(1).lower())
            if mon_num:
                return f"{match.group(2)}-{mon_num}"
        return month

    @api.model
    def get_target(self, month):
        target = self.search([
            ('month', '=', month),
            ('company_id', '=', self.env.company.id)
        ], limit=1)
        return target.target_value if target else 0.0