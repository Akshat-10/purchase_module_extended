# -*- coding: utf-8 -*-

from odoo import models, fields

class ResCompany(models.Model):
    _inherit = 'res.company'

    footer_cin = fields.Char(string='CIN')
    footer_iso = fields.Char(string='ISO')
    footer_bis = fields.Char(string='BIS')
    footer_phone = fields.Char(string='Phone')
    footer_address = fields.Text(string='Address')
    footer_email = fields.Char(string='Email')
    footer_website = fields.Char(string='Website')

