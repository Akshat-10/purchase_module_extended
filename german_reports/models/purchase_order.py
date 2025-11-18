# -*- coding: utf-8 -*-

from odoo import api, fields, models


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    order_type = fields.Selection([
        ('purchase_order', 'Purchase Order'),
        ('work_order', 'Work Order'),
        ('service_order', 'Service Order'),
        ('amc', 'AMC'),
    ], string='Order Type', default='purchase_order', required=True, tracking=True)

    def _get_report_base_filename(self):
        self.ensure_one()
        type_names = {
            'purchase_order': 'Purchase Order',
            'work_order': 'Work Order',
            'service_order': 'Service Order',
            'amc': 'AMC',
        }
        type_name = type_names.get(self.order_type, 'Purchase Order')
        return '%s-%s' % (type_name, self.name)
