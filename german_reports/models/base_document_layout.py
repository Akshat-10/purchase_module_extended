# -*- coding: utf-8 -*-

from odoo import fields, models


class BaseDocumentLayout(models.TransientModel):
    _inherit = 'base.document.layout'

    # Related fields so preview wizard exposes the same attributes as company
    report_header_image = fields.Binary(related='company_id.report_header_image', readonly=False)
    report_footer_image = fields.Binary(related='company_id.report_footer_image', readonly=False)
