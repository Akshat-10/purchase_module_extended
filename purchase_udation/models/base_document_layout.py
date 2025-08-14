# -*- coding: utf-8 -*-

from odoo import models, fields

class BaseDocumentLayout(models.TransientModel):
    _inherit = 'base.document.layout'

    # Add the footer fields as related fields
    footer_cin = fields.Char(related='company_id.footer_cin', readonly=False)
    footer_iso = fields.Char(related='company_id.footer_iso', readonly=False)
    footer_bis = fields.Char(related='company_id.footer_bis', readonly=False)
    footer_phone = fields.Char(related='company_id.footer_phone', readonly=False)
    footer_address = fields.Text(related='company_id.footer_address', readonly=False)
    footer_email = fields.Char(related='company_id.footer_email', readonly=False)
    footer_website = fields.Char(related='company_id.footer_website', readonly=False)
