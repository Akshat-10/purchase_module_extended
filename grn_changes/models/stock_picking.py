# -*- coding: utf-8 -*-
from odoo import models, fields, api


class StockPicking(models.Model):
    _inherit = 'stock.picking'

    bill_no = fields.Char(string='Bill No.')
    bill_date = fields.Date(string='Bill Date')
    vehicle_no = fields.Char(string='Vehicle No.')
    supplier_invoice_value = fields.Float(
        string='Supplier Invoice Value',
        compute='_compute_supplier_invoice_value',
        store=True
    )
    price_matches_po = fields.Boolean(
        string='Price Matches PO',
        compute='_compute_price_matches_po',
        store=True
    )
    price_mismatch_reason = fields.Text(string='Price Mismatch Reason')

    @api.depends('move_ids_without_package.product_id')
    def _compute_supplier_invoice_value(self):
        """Automatically fetch product cost (standard_price) from product"""
        for picking in self:
            if picking.move_ids_without_package:
                # Get the first product's standard price (cost)
                first_move = picking.move_ids_without_package[0]
                picking.supplier_invoice_value = first_move.product_id.standard_price
            else:
                picking.supplier_invoice_value = 0.0

    @api.depends('move_ids_without_package.purchase_line_unit_price', 'supplier_invoice_value')
    def _compute_price_matches_po(self):
        """Compare supplier invoice value with PO unit prices"""
        for picking in self:
            if picking.move_ids_without_package and picking.supplier_invoice_value:
                # Get all PO unit prices
                po_prices = picking.move_ids_without_package.filtered(
                    lambda m: m.purchase_line_unit_price
                ).mapped('purchase_line_unit_price')

                # Check if supplier invoice value matches any PO price (with small tolerance for float comparison)
                tolerance = 0.01
                picking.price_matches_po = any(
                    abs(price - picking.supplier_invoice_value) < tolerance
                    for price in po_prices
                )
            else:
                picking.price_matches_po = False


class StockMove(models.Model):
    _inherit = 'stock.move'

    purchase_line_unit_price = fields.Monetary(
        string='Unit Price',
        compute='_compute_purchase_line_unit_price',
        store=True,
        currency_field='currency_id',
        help='Product cost from product master (standard_price)'
    )

    @api.depends('product_id', 'product_id.standard_price')
    def _compute_purchase_line_unit_price(self):
        """
        Get the cost directly from product.standard_price
        """
        for move in self:
            if move.product_id:
                # Get cost from product's standard_price (Cost field)
                move.purchase_line_unit_price = move.product_id.standard_price
            else:
                move.purchase_line_unit_price = 0.0

    @api.depends('product_id')
    def _compute_currency_id(self):
        """Ensure currency_id is available for monetary field"""
        for move in self:
            move.currency_id = move.company_id.currency_id or self.env.company.currency_id

    currency_id = fields.Many2one(
        'res.currency',
        compute='_compute_currency_id',
        store=True
    )


class StockMoveLine(models.Model):
    _inherit = 'stock.move.line'

    def _get_aggregated_product_quantities(self, strict=False, **kwargs):
        """
        Override to ensure qty_ordered comes from purchase order line instead of product_uom_qty
        """
        # Call parent method
        aggregated_move_lines = super()._get_aggregated_product_quantities(strict=strict, **kwargs)

        # Update qty_ordered to come from purchase order if available
        for key, values in aggregated_move_lines.items():
            # Try different possible key names for product and uom
            product_id = values.get('product') or values.get('product_id')
            product_uom = values.get('uom') or values.get('product_uom') or values.get('product_uom_id')

            # Get all move lines that match this aggregated line
            matching_lines = self.filtered(lambda ml:
                                           ml.product_id == product_id and
                                           ml.product_uom_id == product_uom
                                           )

            if matching_lines:
                first_move_line = matching_lines[0]
                stock_move = first_move_line.move_id

                # Get the purchase line from the stock move
                purchase_line = stock_move.purchase_line_id

                if purchase_line:
                    # Use the original purchase order quantity
                    aggregated_move_lines[key]['qty_ordered'] = purchase_line.product_qty
                else:
                    # Fallback: use the move's product_uom_qty
                    aggregated_move_lines[key]['qty_ordered'] = stock_move.product_uom_qty

        return aggregated_move_lines