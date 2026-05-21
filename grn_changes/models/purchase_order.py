# -*- coding: utf-8 -*-
from odoo import models, fields, api


class PurchaseOrder(models.Model):
    _inherit = 'purchase.order'

    digital_signature = fields.Binary(string='Signature',
                                      help="Digital signature file")
    prepared_by = fields.Char(string='Prepared By',
                              default=lambda self: self.env.user.name,
                              help="Auto-filled with the user who created the PO. "
                                   "Can be overridden manually.")
    approved_by = fields.Char(string='Approved By',
                              help="Auto-filled when Confirm Order is clicked. "
                                   "Can be overridden manually.")
    authorised_by = fields.Char(string='Authorised By',
                                help="Auto-filled when the PO is finally approved. "
                                     "Can be overridden manually.")

    def button_confirm(self):
        res = super().button_confirm()
        for order in self:
            if not order.approved_by:
                order.approved_by = self.env.user.name
        return res

    def button_approve(self, force=False):
        res = super().button_approve(force=force)
        for order in self:
            if not order.authorised_by:
                order.authorised_by = self.env.user.name
        return res


class PurchaseOrderLine(models.Model):
    _inherit = 'purchase.order.line'

    product_cost = fields.Monetary(
        string='Unit Price',
        compute='_compute_product_cost',
        store=True,
        currency_field='currency_id',
        help='Product cost from product master (standard_price)'
    )

    @api.depends('product_id', 'product_id.standard_price')
    def _compute_product_cost(self):
        for line in self:
            if line.product_id:
                # Get the cost from product's standard_price field
                line.product_cost = line.product_id.standard_price
            else:
                line.product_cost = 0.0