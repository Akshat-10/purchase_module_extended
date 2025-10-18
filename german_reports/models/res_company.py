# -*- coding: utf-8 -*-
# Customization: Header/Footer images per company with VAT-based auto defaults

import base64
import logging
import os

from odoo import api, fields, models, tools

_logger = logging.getLogger(__name__)


class ResCompany(models.Model):
    _inherit = 'res.company'

    report_header_image = fields.Binary(
        string='Report Header Image',
        attachment=True,
        help='Image used at the top of reports for this company.'
    )
    report_footer_image = fields.Binary(
        string='Report Footer Image',
        attachment=True,
        help='Image used at the bottom of reports for this company.'
    )

    # Known VAT -> static image filenames mapping
    _VAT_IMAGE_MAP = {
        '24AACCH0669K1ZJ': {
            'header': 'ggspl_header.png',
            'footer': 'ggspl_footer.png',
        },
        '24AAJCG1185G1ZP': {
            'header': 'gtpl_header.png',
            'footer': 'gtpl_footer.png',
        },
    }

    def _gr_get_static_img_dir(self):
        # Resolve module static directory absolute path
        module_root = tools.config['data_dir'] if False else None  # placeholder hint
        # Build from this file location
        current_dir = os.path.dirname(__file__)
        module_dir = os.path.abspath(os.path.join(current_dir, os.pardir))
        static_dir = os.path.join(module_dir, 'static', 'src', 'img')
        return static_dir

    def _gr_load_image_file(self, filename):
        if not filename:
            return False
        try:
            path = filename
            # Allow both absolute and basename; if only basename provided, join module static path
            if not os.path.isabs(path):
                path = os.path.join(self._gr_get_static_img_dir(), filename)
            if os.path.isfile(path):
                with open(path, 'rb') as f:
                    return base64.b64encode(f.read())
        except Exception as e:
            _logger.warning('Failed loading image %s: %s', filename, e)
        return False

    def _gr_set_images_from_vat(self):
        """Set header/footer images based on VAT mapping. Return True if set."""
        updated = False
        for company in self:
            vat = (company.vat or '').strip()
            mapping = self._VAT_IMAGE_MAP.get(vat)
            if mapping:
                header = company._gr_load_image_file(mapping.get('header'))
                footer = company._gr_load_image_file(mapping.get('footer'))
                vals = {}
                if header:
                    vals['report_header_image'] = header
                if footer:
                    vals['report_footer_image'] = footer
                if vals:
                    super(ResCompany, company.sudo()).write(vals)
                    updated = True
            else:
                # Not matched: do not overwrite manually set images; only clear if both empty
                # Keep as-is; caller can choose to clear
                _logger.info('No VAT image mapping for company %s (VAT=%s)', company.name, vat)
        return updated

    @api.onchange('vat')
    def _onchange_vat_gr_images(self):
        for company in self:
            # If VAT matches, auto-populate; otherwise clear to let user set manually
            vat = (company.vat or '').strip()
            mapping = self._VAT_IMAGE_MAP.get(vat)
            if mapping:
                company.report_header_image = company._gr_load_image_file(mapping.get('header'))
                company.report_footer_image = company._gr_load_image_file(mapping.get('footer'))
            else:
                company.report_header_image = False
                company.report_footer_image = False

    @api.model_create_multi
    def create(self, vals_list):
        companies = super().create(vals_list)
        # After creation, populate images based on VAT if available
        companies._gr_set_images_from_vat()
        return companies

    def write(self, vals):
        res = super().write(vals)
        # If VAT changed and user didn't explicitly set images, try auto populate
        if 'vat' in vals and 'report_header_image' not in vals and 'report_footer_image' not in vals:
            self._gr_set_images_from_vat()
        return res
