# -*- coding: utf-8 -*-
{
    'name': 'German Reports Layout',
    'version': '18.0.1.0.0',
    'summary': 'Custom header/footer images for reports',
    'category': 'Reporting',
    "author": "Akshat Gupta",
    'license': 'LGPL-3',    
    'website': 'https://github.com/Akshat-10',
    'depends': ['base', 'web', 'purchase', 'digital_signature'],
    'data': [
        'views/report_layout_inherit.xml',
        'views/res_company_view.xml',
        'views/purchase_order_report_updation.xml',
        'views/purchase_report_german.xml',
    ],
    'assets': {
        'web.report_assets_common': [
            'german_reports/static/src/css/report.css',
        ],
    },
    'installable': True,
}

