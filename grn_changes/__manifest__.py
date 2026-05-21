{
    'name': 'GRN Changes',
    'version': '18.0.1.0.0',
    'category': 'Inventory',
    'summary': 'Add Next Transfer button to picking form header',
    'description': """
        This module is for grn changes.
    """,
    'author': 'Your Company',
    'website': 'https://www.yourcompany.com',
    'depends': ['stock', 'purchase'],
    'data': [
        'views/stock_picking_views.xml',
        'views/purchase_order_views.xml',
        'reports/delivery_slip_report_fix.xml',
        'reports/stock_picking_templates.xml',
    ],
    'installable': True,
    'application': False,
    'auto_install': False,
    'license': 'LGPL-3',
}