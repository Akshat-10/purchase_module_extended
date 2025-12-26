# -*- coding: utf-8 -*-
from odoo import models, fields, api


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