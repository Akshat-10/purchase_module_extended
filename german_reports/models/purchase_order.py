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

    purchase_order_date = fields.Date(
        string='Purchase Order Date',
        copy=False,
        tracking=True,
        # default=fields.Date.context_today,
        help='Date of the confirmed Purchase Order. Set automatically when PO is confirmed, but can be modified.',
    )

    def button_approve(self, force=False):
        """Override to generate confirmed PO number only for purchase_order type and set purchase_order_date."""
        res = super().button_approve(force=force)
        for order in self:
            # Set purchase_order_date if not already set
            if order.state in ('purchase', 'done') and not order.purchase_order_date:
                order.purchase_order_date = fields.Date.context_today(order)
            # Only generate po_confirmed_number for purchase_order type
            if (order.state in ('purchase', 'done') 
                    and order.order_type == 'purchase_order' 
                    and not order.po_confirmed_number):
                order._generate_confirmed_po_number()
        return res

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
