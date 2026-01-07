# -*- coding: utf-8 -*-
from odoo import api, fields, models, _

class PurchaseTarget(models.Model):
    _name = 'purchase.target'
    _description = 'Monthly Purchase Target'
    _rec_name = 'month'

    month = fields.Char(
        string='Month',
        required=True,
        help='Format: YYYY-MM (e.g., 2025-01)'
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

    @api.model
    def get_all_targets(self):
        """Get all targets as a dictionary"""
        targets = self.search([('company_id', '=', self.env.company.id)])
        return {target.month: target.target_value for target in targets}

    @api.model
    def set_target(self, month, value):
        """Set or update target for a specific month"""
        try:
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
    def get_target(self, month):
        """Get target for a specific month"""
        target = self.search([
            ('month', '=', month),
            ('company_id', '=', self.env.company.id)
        ], limit=1)
        return target.target_value if target else 0.0