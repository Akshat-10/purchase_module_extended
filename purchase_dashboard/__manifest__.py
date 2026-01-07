# -*- coding: utf-8 -*-
{
    'name': 'Purchase Dashboard',
    'version': '18.0.1.0.0',
    'category': 'Purchase',
    'summary': 'Comprehensive Purchase Analytics and Reporting Dashboard',
    'description': """
Purchase Analytics Dashboard
=============================
This module provides a comprehensive dashboard for purchase analytics including:

* Total Spend (Yearly)
* Top Suppliers Analysis
* Number of Items with Purchase Orders
* Monthly Release PO (Planned vs Expected)
* Monthly PO Values (Planned vs Expected)
* Total Inventory Cost
* Not Moved Inventory (30, 45, 60 days)
* New Vendor Tracking
* Consumption Cycle Analysis (Avg. Days)
* Department-wise Consumption
* Spend by Commodity/Category

Features:
---------
* Real-time metrics computation
* Interactive filtering by date range
* Drill-down capabilities
* Export functionality
* Multi-company support
    """,
    'author': 'ASD',
    'website': 'https://www.yourcompany.com',
    'depends': [
        'purchase',
        'stock',
        'product',
        'account',
        'analytic',
    ],
    'data': [
        'security/ir.model.access.csv',
        'views/purchase_dashboard_actions.xml',
        'views/purchase_target_views.xml',
    ],
    'assets': {
            'web.assets_backend': [
                'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/3.9.1/chart.min.js',
                'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/5.15.4/css/all.min.css',
                'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
                'purchase_dashboard/static/src/js/purchase_dashboard.js',
                'purchase_dashboard/static/src/css/purchase_dashboard.css',
                'purchase_dashboard/static/src/xml/purchase_dashboard.xml',
                'purchase_dashboard/static/src/js/master_comparison_dashboard.js',
                'purchase_dashboard/static/src/css/master_comparison_dashboard.css',
                'purchase_dashboard/static/src/xml/master_comparison_dashboard.xml',
                'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
            ],
        },
    'demo': [],
    'installable': True,
    'application': True,
    'auto_install': False,
    'license': 'LGPL-3',
}