/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { loadJS } from "@web/core/assets";

export class PurchaseDashboard extends Component {
    static template = "purchase_dashboard.Dashboard";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            totalSpendYearly: 0,
            totalInventoryCost: 0,
            topSuppliers: [],
            newVendorsCount: 0,
            itemsWithPO: 0,
            monthlyReleasePO: [],
            monthlyPOValues: [],
            monthlyPOStatus: [],
            monthlyGRN: [],
            grnClearedCount: 0,
            notMoved30: 0,
            notMoved45: 0,
            notMoved60: 0,
            notMovedDetails: [],
            avgConsumptionCycle: 0,
            avgIndentToPO: 0,
            avgPOToReceipt: 0,
            consumptionByProduct: [],
            departmentConsumption: [],
            departmentInventory: [],
            commoditySpend: [],
            dateFrom: this.getYearStart(),
            dateTo: this.getCurrentDate(),
            companyId: null,
            isLoading: false,
        });

        // Chart references
        this.charts = {
            topSuppliers: null,
            monthlyPO: null,
            monthlyValues: null,
            monthlyPOStatus: null,
            monthlyGRN: null,
            commodity: null,
            consumption: null,
            departmentInventory: null,
        };

        onWillStart(async () => {
            await this.loadDashboardData();
        });

        onMounted(async () => {
            await this.initializeCharts();
        });
    }

    getYearStart() {
        const date = new Date();
        return `${date.getFullYear()}-01-01`;
    }

    getCurrentDate() {
        const date = new Date();
        return date.toISOString().split('T')[0];
    }

    async loadDashboardData() {
        this.state.isLoading = true;
        try {
            await Promise.all([
                this.loadFinancialMetrics(),
                this.loadSupplierData(),
                this.loadPOMetrics(),
                this.loadInventoryMetrics(),
                this.loadConsumptionMetrics(),
                this.loadCommodityData(),
                this.loadGRNMetrics(),
                this.loadTimingMetrics(),
                this.loadDepartmentInventory(),
            ]);
        } catch (error) {
            console.error("Error loading dashboard data:", error);
        } finally {
            this.state.isLoading = false;
        }
    }

    async loadFinancialMetrics() {
        try {
            const result = await this.orm.searchRead(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                ],
                ['amount_total']
            );

            console.log("Purchase Orders:", result);
            this.state.totalSpendYearly = result.reduce((sum, po) => sum + (po.amount_total || 0), 0);

            const quants = await this.orm.searchRead(
                "stock.quant",
                [
                    ['quantity', '>', 0],
                    ['location_id.usage', '=', 'internal'],
                ],
                ['quantity', 'product_id', 'value']
            );

            this.state.totalInventoryCost = quants.reduce((sum, q) => sum + (q.value || 0), 0);
        } catch (error) {
            console.error("Error loading financial metrics:", error);
        }
    }

    async loadSupplierData() {
        try {
            const topSuppliersData = await this.orm.readGroup(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                ],
                ['partner_id', 'amount_total:sum'],
                ['partner_id'],
                { limit: 10, orderby: 'amount_total desc' }
            );

            this.state.topSuppliers = topSuppliersData.map(item => ({
                id: item.partner_id[0],
                name: item.partner_id[1],
                totalSpend: item.amount_total,
                poCount: item.partner_id_count,
            }));

            const monthStart = new Date();
            monthStart.setDate(1);
            const monthStartStr = monthStart.toISOString().split('T')[0];

            const newVendors = await this.orm.searchCount(
                "res.partner",
                [
                    ['supplier_rank', '>', 0],
                    ['create_date', '>=', monthStartStr],
                ]
            );
            this.state.newVendorsCount = newVendors;

            console.log("Suppliers loaded:", this.state.topSuppliers.length);
        } catch (error) {
            console.error("Error loading supplier data:", error);
        }
    }

    async loadPOMetrics() {
        try {
            const productCount = await this.orm.searchCount(
                "product.template",
                [
                    ['active', '=', true],
                ]
            );

            this.state.itemsWithPO = productCount;

            const monthlyData = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            this.state.monthlyReleasePO = this.processMonthlyData(monthlyData);

            const monthlyValues = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['amount_total:sum'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            this.state.monthlyPOValues = this.processMonthlyValues(monthlyValues);

            // Load monthly PO status (approved, pending) and indents
            await this.loadMonthlyPOStatus();

            console.log("PO Metrics loaded");
        } catch (error) {
            console.error("Error loading PO metrics:", error);
        }
    }

    async loadMonthlyPOStatus() {
        try {
            // Get monthly approved POs
            const approvedPOs = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                    ['state', 'in', ['purchase', 'done']],
                ],
                ['__count'],
                ['date_approve:month'],
                { lazy: false }
            );

            // Get monthly pending POs
            const pendingPOs = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                    ['state', 'in', ['draft', 'sent', 'to approve']],
                ],
                ['__count'],
                ['date_order:month'],
                { lazy: false }
            );

            // Get monthly indents (purchase requests)
            const indents = await this.orm.readGroup(
                "purchase.request",
                [
                    ['date_start', '>=', this.state.dateFrom],
                    ['date_start', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_start:month'],
                { lazy: false }
            );

            // Combine the data
            const monthlyStatus = {};

            approvedPOs.forEach(item => {
                const month = item['date_approve:month'];
                if (!monthlyStatus[month]) {
                    monthlyStatus[month] = { month, approved: 0, pending: 0, indent: 0 };
                }
                monthlyStatus[month].approved = item.__count || 0;
            });

            pendingPOs.forEach(item => {
                const month = item['date_order:month'];
                if (!monthlyStatus[month]) {
                    monthlyStatus[month] = { month, approved: 0, pending: 0, indent: 0 };
                }
                monthlyStatus[month].pending = item.__count || 0;
            });

            indents.forEach(item => {
                const month = item['date_start:month'];
                if (!monthlyStatus[month]) {
                    monthlyStatus[month] = { month, approved: 0, pending: 0, indent: 0 };
                }
                monthlyStatus[month].indent = item.__count || 0;
            });

            this.state.monthlyPOStatus = Object.values(monthlyStatus)
                .sort((a, b) => a.month.localeCompare(b.month));

            console.log("Monthly PO status loaded");
        } catch (error) {
            console.error("Error loading monthly PO status:", error);
            this.state.monthlyPOStatus = [];
        }
    }

    async loadGRNMetrics() {
        try {
            // Get current month's GRN count
//            const monthStart = new Date();
//            monthStart.setDate(1);
//            const monthStartStr = monthStart.toISOString().split('T')[0];

            const currentMonthGRN = await this.orm.searchCount(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', '=', 'done'],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ]
            );

            this.state.grnClearedCount = currentMonthGRN;

            // Get monthly GRN data for chart
            const monthlyGRNData = await this.orm.readGroup(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', '=', 'done'],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_done:month'],
                { lazy: false }
            );

            // Get GRN IDs to calculate value
            const grnIds = await this.orm.search(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', '=', 'done'],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ],
            );

            // Get move lines to calculate total value
            const moveLines = await this.orm.searchRead(
                "stock.move",
                [
                    ['picking_id', 'in', grnIds],
                    ['state', '=', 'done'],
                ],
                ['picking_id', 'product_uom_qty', 'price_unit', 'date']
            );

            // Calculate monthly values
            const monthlyValues = {};
            moveLines.forEach(move => {
                const date = new Date(move.date);
                const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                const value = (move.product_uom_qty || 0) * (move.price_unit || 0);

                if (!monthlyValues[month]) {
                    monthlyValues[month] = 0;
                }
                monthlyValues[month] += value;
            });

            this.state.monthlyGRN = monthlyGRNData.map(item => ({
                month: item['date_done:month'],
                count: item.__count || 0,
                value: monthlyValues[item['date_done:month']] || 0,
            })).sort((a, b) => a.month.localeCompare(b.month));

            console.log("GRN metrics loaded");
        } catch (error) {
            console.error("Error loading GRN metrics:", error);
            this.state.grnClearedCount = 0;
            this.state.monthlyGRN = [];
        }
    }
        // ALTERNATIVE METHOD - Try this if the previous one doesn't work
    // This uses a different approach by querying from Purchase Orders side

    async loadTimingMetrics() {
        try {
            console.log('=== LOADING TIMING METRICS (ALTERNATIVE METHOD) ===');

            // METHOD 1: Calculate from Purchase Order Lines that have request lines
            let totalIndentToPODays = 0;
            let indentToPOCount = 0;

            try {
                // Get purchase order lines with request line reference
                const poLines = await this.orm.searchRead(
                    "purchase.order.line",
                    [
                        ['purchase_request_lines', '!=', false],
                    ],
                    ['id', 'order_id', 'purchase_request_lines'],
                    { limit: 1000 }
                );

                console.log('PO Lines with request lines found:', poLines.length);

                if (poLines.length > 0) {
                    // Get unique PO IDs
                    const poIds = [...new Set(poLines.map(line => line.order_id[0]))];

                    // Get PO details
                    const pos = await this.orm.searchRead(
                        "purchase.order",
                        [['id', 'in', poIds]],
                        ['id', 'name', 'date_order', 'date_approve']
                    );

                    const poMap = {};
                    pos.forEach(po => {
                        poMap[po.id] = po;
                    });

                    // Get unique request line IDs
                    const allRequestLineIds = [];
                    poLines.forEach(line => {
                        if (line.purchase_request_lines) {
                            allRequestLineIds.push(...line.purchase_request_lines);
                        }
                    });

                    if (allRequestLineIds.length > 0) {
                        // Get request line details
                        const requestLines = await this.orm.searchRead(
                            "purchase.request.line",
                            [['id', 'in', allRequestLineIds]],
                            ['id', 'request_id']
                        );

                        // Get unique request IDs
                        const requestIds = [...new Set(requestLines.map(rl => rl.request_id[0]))];

                        // Get request details
                        const requests = await this.orm.searchRead(
                            "purchase.request",
                            [['id', 'in', requestIds]],
                            ['id', 'name', 'date_start']
                        );

                        const requestMap = {};
                        requests.forEach(req => {
                            requestMap[req.id] = req;
                        });

                        // Map request lines to requests
                        const requestLineToRequest = {};
                        requestLines.forEach(rl => {
                            requestLineToRequest[rl.id] = rl.request_id[0];
                        });

                        // Calculate days for each PO line
                        for (const line of poLines) {
                            try {
                                const po = poMap[line.order_id[0]];
                                if (!po || !line.purchase_request_lines || line.purchase_request_lines.length === 0) {
                                    continue;
                                }

                                const requestLineId = line.purchase_request_lines[0];
                                const requestId = requestLineToRequest[requestLineId];
                                const request = requestMap[requestId];

                                if (request && request.date_start && (po.date_order || po.date_approve)) {
                                    const indentDate = new Date(request.date_start);
                                    const poDate = new Date(po.date_order || po.date_approve);
                                    const days = Math.floor((poDate - indentDate) / (1000 * 60 * 60 * 24));

                                    console.log(`Request ${request.name} (${request.date_start}) -> PO ${po.name} (${po.date_order || po.date_approve}) = ${days} days`);

                                    if (days >= 0 && days < 365) {
                                        totalIndentToPODays += days;
                                        indentToPOCount++;
                                    }
                                }
                            } catch (err) {
                                console.error("Error processing PO line:", err);
                            }
                        }
                    }
                }
            } catch (err) {
                console.error("Error in Method 1:", err);
            }

            console.log(`Indent to PO - Total Days: ${totalIndentToPODays}, Count: ${indentToPOCount}`);

            this.state.avgIndentToPO = indentToPOCount > 0
                ? (totalIndentToPODays / indentToPOCount).toFixed(2)
                : 0;

            // Calculate average time from PO to receipt
            const purchaseOrders = await this.orm.searchRead(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['picking_ids', '!=', false],
                ],
                ['id', 'name', 'date_approve', 'date_order', 'picking_ids'],
                { limit: 1000 }
            );

            console.log('Purchase Orders with pickings found:', purchaseOrders.length);

            let totalPOToReceiptDays = 0;
            let poToReceiptCount = 0;

            for (const po of purchaseOrders) {
                try {
                    const pickingIds = po.picking_ids;
                    if (pickingIds && pickingIds.length > 0) {
                        const pickings = await this.orm.searchRead(
                            "stock.picking",
                            [
                                ['id', 'in', pickingIds],
                                ['state', '=', 'done'],
                                ['picking_type_code', '=', 'incoming'],
                            ],
                            ['id', 'name', 'date_done']
                        );

                        if (pickings.length > 0 && pickings[0].date_done) {
                            const poDate = new Date(po.date_approve || po.date_order);
                            const receiptDate = new Date(pickings[0].date_done);
                            const days = Math.floor((receiptDate - poDate) / (1000 * 60 * 60 * 24));

                            console.log(`PO ${po.name} (${po.date_approve || po.date_order}) -> Receipt ${pickings[0].name} (${pickings[0].date_done}) = ${days} days`);

                            if (days >= 0 && days < 365) {
                                totalPOToReceiptDays += days;
                                poToReceiptCount++;
                            }
                        }
                    }
                } catch (err) {
                    console.error("Error processing PO:", err);
                }
            }

            console.log(`PO to Receipt - Total Days: ${totalPOToReceiptDays}, Count: ${poToReceiptCount}`);

            this.state.avgPOToReceipt = poToReceiptCount > 0
                ? (totalPOToReceiptDays / poToReceiptCount).toFixed(2)
                : 0;

            console.log('=== TIMING METRICS COMPLETE ===');
            console.log(`Final Results - Indent to PO: ${this.state.avgIndentToPO} days, PO to Receipt: ${this.state.avgPOToReceipt} days`);
        } catch (error) {
            console.error("Error loading timing metrics:", error);
            this.state.avgIndentToPO = 0;
            this.state.avgPOToReceipt = 0;
        }
    }

    async loadInventoryMetrics() {
        try {
            const today = new Date();
            console.log('=== LOADING INVENTORY METRICS ===');

            // Get all products with current inventory
            const quants = await this.orm.searchRead(
                "stock.quant",
                [
                    ['quantity', '>', 0],
                    ['location_id.usage', '=', 'internal'],
                ],
                ['product_id', 'quantity', 'inventory_value'],
                { limit: 1000 }
            );

            console.log('Products with inventory:', quants.length);

            if (quants.length === 0) {
                this.state.notMoved30 = 0;
                this.state.notMoved45 = 0;
                this.state.notMoved60 = 0;
                this.state.notMovedDetails = [];
                return;
            }

            const productIds = [...new Set(quants.map(q => q.product_id[0]))];
            console.log('Unique products:', productIds.length);

            // Get last INTERNAL transfer date for each product
            const recentPickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'internal'],
                    ['state', '=', 'done'],
                    ['date_done', '!=', false],
                ],
                ['id', 'date_done', 'move_ids_without_package'],
                { limit: 1000 }
            );

            console.log('Internal transfers found:', recentPickings.length);

            // Get all move IDs from these pickings
            const allMoveIds = [];
            recentPickings.forEach(picking => {
                if (picking.move_ids_without_package && picking.move_ids_without_package.length > 0) {
                    allMoveIds.push(...picking.move_ids_without_package);
                }
            });

            console.log('Total moves in internal transfers:', allMoveIds.length);

            // Get product info from these moves
            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ['id', 'in', allMoveIds],
                    ['product_id', 'in', productIds],
                    ['state', '=', 'done'],
                ],
                ['product_id', 'date', 'picking_id'],
                { limit: 5000 }
            );

            console.log('Moves for our products:', moves.length);

            // Map picking dates
            const pickingDateMap = {};
            recentPickings.forEach(p => {
                pickingDateMap[p.id] = new Date(p.date_done);
            });

            // Map each product to its most recent internal transfer date
            const lastTransferMap = {};
            moves.forEach(move => {
                const prodId = move.product_id[0];
                const pickingDate = pickingDateMap[move.picking_id[0]];

                if (pickingDate && (!lastTransferMap[prodId] || pickingDate > lastTransferMap[prodId])) {
                    lastTransferMap[prodId] = pickingDate;
                }
            });

            console.log('Products with transfer history:', Object.keys(lastTransferMap).length);

            let count30 = 0;
            let count45 = 0;
            let count60 = 0;
            const notMovedDetails = [];

            // Aggregate quantities by product
            const productQuantMap = {};
            quants.forEach(q => {
                const prodId = q.product_id[0];
                if (!productQuantMap[prodId]) {
                    productQuantMap[prodId] = {
                        productId: prodId,
                        productName: q.product_id[1],
                        totalQty: 0,
                        totalValue: 0,
                    };
                }
                productQuantMap[prodId].totalQty += q.quantity;
                productQuantMap[prodId].totalValue += (q.inventory_value || 0);
            });

            // Calculate days not moved for each product
            Object.values(productQuantMap).forEach(product => {
                const lastTransferDate = lastTransferMap[product.productId];

                if (!lastTransferDate) {
                    // No internal transfer found - never moved
                    count60++;
                    notMovedDetails.push({
                        productId: product.productId,
                        productName: product.productName,
                        lastMove: 'Never',
                        daysNotMoved: 999,
                        qty: product.totalQty,
                        value: product.totalValue,
                    });
                    console.log('Never moved:', product.productName);
                } else {
                    const daysNotMoved = Math.floor((today - lastTransferDate) / (1000 * 60 * 60 * 24));

                    console.log('Product:', product.productName, '| Last:', lastTransferDate.toISOString().split('T')[0], '| Days:', daysNotMoved);

                    if (daysNotMoved >= 60) {
                        count60++;
                        notMovedDetails.push({
                            productId: product.productId,
                            productName: product.productName,
                            lastMove: lastTransferDate.toISOString().split('T')[0],
                            daysNotMoved: daysNotMoved,
                            qty: product.totalQty,
                            value: product.totalValue,
                        });
                    } else if (daysNotMoved >= 45) {
                        count45++;
                    } else if (daysNotMoved >= 30) {
                        count30++;
                    }
                }
            });

            console.log('Not moved 30+ days:', count30);
            console.log('Not moved 45+ days:', count45);
            console.log('Not moved 60+ days:', count60);

            this.state.notMoved30 = count30;
            this.state.notMoved45 = count45;
            this.state.notMoved60 = count60;
            this.state.notMovedDetails = notMovedDetails.sort((a, b) => b.daysNotMoved - a.daysNotMoved);

            console.log('=== END INVENTORY METRICS ===');

        } catch (error) {
            console.error("Error loading inventory metrics:", error);
            this.state.notMoved30 = 0;
            this.state.notMoved45 = 0;
            this.state.notMoved60 = 0;
            this.state.notMovedDetails = [];
        }
    }

    async loadConsumptionMetrics() {
        try {
            const poLines = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.date_order', '>=', this.state.dateFrom],
                    ['order_id.date_order', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                ],
                ['product_id', 'date_planned', 'order_id']
            );

            if (poLines.length === 0) {
                this.state.avgConsumptionCycle = 0;
                this.state.consumptionByProduct = [];
                return;
            }

            const poIds = [...new Set(poLines.map(line => line.order_id[0]))];
            const purchaseOrders = await this.orm.read(
                "purchase.order",
                poIds,
                ['date_order', 'date_approve']
            );

            const poDateMap = {};
            purchaseOrders.forEach(po => {
                poDateMap[po.id] = po.date_order || po.date_approve;
            });

            const productCycles = {};
            let totalDays = 0;
            let totalCount = 0;

            for (const line of poLines) {
                const productId = line.product_id[0];
                const productName = line.product_id[1];
                const plannedDate = line.date_planned;
                const orderDate = poDateMap[line.order_id[0]];

                if (plannedDate && orderDate) {
                    const planned = new Date(plannedDate);
                    const ordered = new Date(orderDate);
                    const days = Math.floor((planned - ordered) / (1000 * 60 * 60 * 24));

                    if (days > 0 && days < 365) {
                        if (!productCycles[productId]) {
                            productCycles[productId] = {
                                productName: productName,
                                totalDays: 0,
                                count: 0,
                            };
                        }
                        productCycles[productId].totalDays += days;
                        productCycles[productId].count++;
                        totalDays += days;
                        totalCount++;
                    }
                }
            }

            this.state.avgConsumptionCycle = totalCount > 0
                ? (totalDays / totalCount).toFixed(2)
                : 0;

            this.state.consumptionByProduct = Object.values(productCycles)
                .map(p => ({
                    productName: p.productName,
                    avgDays: (p.totalDays / p.count).toFixed(2),
                }))
                .sort((a, b) => parseFloat(b.avgDays) - parseFloat(a.avgDays))
                .slice(0, 20);

            console.log("Consumption metrics loaded");
        } catch (error) {
            console.error("Error loading consumption metrics:", error);
            this.state.avgConsumptionCycle = 0;
            this.state.consumptionByProduct = [];
        }
    }

    async loadCommodityData() {
        try {
            const categoryData = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.date_approve', '>=', this.state.dateFrom],
                    ['order_id.date_approve', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                ],
                ['price_subtotal', 'product_id'],
                { limit: 5000 }
            );

            const categorizedData = {};

            for (const item of categoryData.slice(0, 20)) {
                try {
                    const product = await this.orm.read(
                        "product.product",
                        [item.product_id[0]],
                        ['categ_id']
                    );

                    if (product[0] && product[0].categ_id) {
                        const categId = product[0].categ_id[0];
                        const categName = product[0].categ_id[1];

                        if (!categorizedData[categId]) {
                            categorizedData[categId] = {
                                category: categName,
                                totalSpend: 0,
                                productCount: 0,
                            };
                        }
                        categorizedData[categId].totalSpend += item.price_subtotal || 0;
                        categorizedData[categId].productCount++;
                    }
                } catch (err) {
                    console.error("Error processing product:", err);
                }
            }

            this.state.commoditySpend = Object.values(categorizedData)
                .sort((a, b) => b.totalSpend - a.totalSpend);

            console.log("Commodity data loaded:", this.state.commoditySpend.length);
        } catch (error) {
            console.error("Error loading commodity data:", error);
        }
    }

    async loadDepartmentInventory() {
        try {
            console.log('=== LOADING DEPARTMENT INVENTORY ===');

            // Get completed internal transfers with departments
            const pickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'internal'],
                    ['state', '=', 'done'],
                    ['issue_department_id', '!=', false],
                ],
                ['id', 'issue_department_id', 'move_ids_without_package'],
                { limit: 5000 }
            );

            console.log('Pickings with departments:', pickings.length);

            if (pickings.length === 0) {
                this.state.departmentInventory = [];
                return;
            }

            // Get all move IDs
            const allMoveIds = [];
            pickings.forEach(picking => {
                if (picking.move_ids_without_package && picking.move_ids_without_package.length > 0) {
                    allMoveIds.push(...picking.move_ids_without_package);
                }
            });

            // Get moves with product quantities
            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ['id', 'in', allMoveIds],
                    ['state', '=', 'done'],
                ],
                ['product_id', 'picking_id', 'product_uom_qty', 'price_unit'],
                { limit: 10000 }
            );

            console.log('Moves found:', moves.length);

            // Map picking to department
            const pickingDeptMap = {};
            pickings.forEach(p => {
                pickingDeptMap[p.id] = {
                    deptId: p.issue_department_id[0],
                    deptName: p.issue_department_id[1],
                };
            });

            // Aggregate by department
            const deptData = {};
            moves.forEach(move => {
                const dept = pickingDeptMap[move.picking_id[0]];
                if (!dept) return;

                const deptId = dept.deptId;
                const deptName = dept.deptName;

                if (!deptData[deptId]) {
                    deptData[deptId] = {
                        id: deptId,
                        name: deptName,
                        productCount: 0,
                        totalQty: 0,
                        totalValue: 0,
                        products: new Set(),
                    };
                }

                deptData[deptId].products.add(move.product_id[0]);
                deptData[deptId].totalQty += move.product_uom_qty || 0;
                deptData[deptId].totalValue += (move.product_uom_qty || 0) * (move.price_unit || 0);
            });

            // Convert to array
            this.state.departmentInventory = Object.values(deptData)
                .map(d => ({
                    ...d,
                    productCount: d.products.size,
                }))
                .sort((a, b) => b.totalValue - a.totalValue);

            console.log('Department inventory loaded:', this.state.departmentInventory.length);
            console.log('Department data:', this.state.departmentInventory);
        } catch (error) {
            console.error("Error loading department inventory:", error);
            this.state.departmentInventory = [];
        }
    }

    processMonthlyData(data) {
        const monthly = {};

        data.forEach(item => {
            const month = item['date_order:month'];
            if (!month) return;

            if (!monthly[month]) {
                monthly[month] = { month: month, planned: 0, released: 0 };
            }

            const count = item.__count || 0;
            if (item.state === 'draft') {
                monthly[month].planned += count;
            } else if (['purchase', 'done'].includes(item.state)) {
                monthly[month].released += count;
            }
        });

        return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
    }

    processMonthlyValues(data) {
        const monthly = {};

        data.forEach(item => {
            const month = item['date_order:month'];
            if (!month) return;

            if (!monthly[month]) {
                monthly[month] = { month: month, plannedValue: 0, actualValue: 0 };
            }

            const value = item.amount_total || 0;
            if (item.state === 'draft') {
                monthly[month].plannedValue += value;
            } else if (['purchase', 'done'].includes(item.state)) {
                monthly[month].actualValue += value;
            }
        });

        return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
    }

    formatCurrency(value) {
        value = value || 0;

        // Convert to lakhs or crores
        if (value >= 10000000) { // 1 Crore = 10,000,000
            return '₹' + (value / 10000000).toFixed(2) + ' Cr';
        } else if (value >= 100000) { // 1 Lakh = 100,000
            return '₹' + (value / 100000).toFixed(2) + ' L';
        } else if (value >= 1000) { // 1 Thousand = 1,000
            return '₹' + (value / 1000).toFixed(2) + ' K';
        } else {
            return '₹' + value.toFixed(2);
        }
    }

    formatNumber(value) {
        return new Intl.NumberFormat('en-IN').format(value || 0);
    }

    async onRefreshDashboard() {
        // Destroy all existing charts first
        this.destroyAllCharts();

        // Reload data
        await this.loadDashboardData();

        // Wait a bit for the state to update
        await new Promise(resolve => setTimeout(resolve, 300));

        // Recreate charts
        await this.createAllCharts();
    }

    async onDateFilterChange(ev) {
        const field = ev.target.name;
        this.state[field] = ev.target.value;
        await this.onRefreshDashboard();
    }

    async onDownloadDashboard(ev) {
        let buttonElement = null;

        try {
            buttonElement = ev.target.closest('button');

            const originalHTML = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Generating...';
            buttonElement.disabled = true;

            if (typeof html2canvas === 'undefined') {
                console.log('Loading html2canvas library...');
                await loadJS("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
                console.log('html2canvas loaded successfully');
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            const dashboardElement = document.querySelector('.o_com_purchase_dashboard');
            console.log('Dashboard element found:', dashboardElement);

            if (!dashboardElement) {
                throw new Error('Dashboard element not found. Make sure the dashboard is fully loaded.');
            }

            const computedStyle = window.getComputedStyle(dashboardElement);
            const backgroundImage = computedStyle.backgroundImage;

            console.log('Background image:', backgroundImage);

            const canvases = dashboardElement.querySelectorAll('canvas');
            console.log(`Found ${canvases.length} chart canvases`);

            canvases.forEach((canvas, i) => {
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = 'high';
                }
            });

            const rect = dashboardElement.getBoundingClientRect();
            const width = dashboardElement.scrollWidth;
            const height = dashboardElement.scrollHeight;
            console.log(`Dashboard dimensions: ${width}x${height}`);

            console.log('Starting html2canvas capture...');
            const canvas = await html2canvas(dashboardElement, {
                scale: 2,
                logging: false,
                useCORS: true,
                allowTaint: false,
                scrollY: -window.scrollY,
                scrollX: -window.scrollX,
                width: width,
                height: height,
                imageTimeout: 0,
                onclone: (clonedDoc) => {
                    const clonedElement = clonedDoc.querySelector('.o_com_purchase_dashboard');
                    if (clonedElement) {
                        // Force the background image to load by using inline styles
                        const bgImageUrl = '/purchase_dashboard/static/src/img/luxa.org-opacity-changed-._dashboard_bg (1).png';
                        clonedElement.style.background = `url('${bgImageUrl}') no-repeat center center fixed`;
                        clonedElement.style.backgroundSize = 'cover';
                        clonedElement.style.padding = '20px';

                        // Ensure all content is visible with full opacity
                        const allElements = clonedElement.querySelectorAll('*');
                        allElements.forEach(el => {
                            const elemStyle = window.getComputedStyle(el);
                            if (elemStyle.opacity !== '1') {
                                el.style.opacity = '1';
                            }
                            if (elemStyle.visibility !== 'visible') {
                                el.style.visibility = 'visible';
                            }
                        });
                    }
                }
            });

            console.log('Canvas created:', canvas.width, 'x', canvas.height);

            const finalCanvas = document.createElement('canvas');
            finalCanvas.width = canvas.width;
            finalCanvas.height = canvas.height;
            const ctx = finalCanvas.getContext('2d');

            const bgImageUrl = '/purchase_dashboard/static/src/img/luxa.org-opacity-changed-._dashboard_bg (1).png';
            try {
                const bgImg = new Image();
                bgImg.crossOrigin = 'anonymous';

                await new Promise((resolve, reject) => {
                    bgImg.onload = () => {
                        // Draw background image
                        ctx.drawImage(bgImg, 0, 0, finalCanvas.width, finalCanvas.height);
                        // Draw the captured content on top
                        ctx.drawImage(canvas, 0, 0);
                        resolve();
                    };
                    bgImg.onerror = () => {
                        console.log('Background image failed to load, using captured canvas as-is');
                        // Just draw the canvas without background
                        ctx.drawImage(canvas, 0, 0);
                        resolve();
                    };
                    bgImg.src = bgImageUrl;
                });
            } catch (e) {
                console.log('Error loading background:', e);
                ctx.drawImage(canvas, 0, 0);
            }

            finalCanvas.toBlob(async (blob) => {
                if (!blob) {
                    throw new Error('Failed to create image blob');
                }

                console.log('Blob created, size:', (blob.size / 1024 / 1024).toFixed(2), 'MB');

                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                const now = new Date();
                const dateStr = now.toISOString().split('T')[0];
                const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '-');
                link.download = `Purchase_Dashboard_${dateStr}_${timeStr}.png`;
                link.href = url;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);

                console.log('Download triggered successfully');

                if (buttonElement) {
                    buttonElement.innerHTML = originalHTML;
                    buttonElement.disabled = false;
                }
            }, 'image/png', 0.95);

        } catch (error) {
            console.error('Error downloading dashboard:', error);
            console.error('Error details:', error.message);

            alert('Failed to download dashboard. Please try again.\n\nError: ' + error.message);

            if (buttonElement) {
                buttonElement.innerHTML = '<i class="fa fa-download"></i> Download';
                buttonElement.disabled = false;
            }
        }
    }

    async onViewTopSuppliers() {
        if (this.state.topSuppliers.length === 0) {
            return;
        }

        const supplierIds = this.state.topSuppliers.map(s => s.id);
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'res.partner',
            name: 'Top Suppliers',
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', supplierIds]],
            context: { create: false },
        });
    }

    async onViewTotalPOs() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: 'Purchase Orders',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['purchase', 'done']],
                ['date_approve', '>=', this.state.dateFrom],
                ['date_approve', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewTotalInventory() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.quant',
            name: 'Inventory',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['quantity', '>', 0],
                ['location_id.usage', '=', 'internal'],
            ],
            context: { create: false },
        });
    }

    async onViewItemsWithPO() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.product',
            name: 'Products with Purchase Orders',
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }

    async onViewGRNCleared() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: 'GRN Cleared',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['picking_type_code', '=', 'incoming'],
                ['state', '=', 'done'],
                ['date_done', '>=', this.state.dateFrom],
                ['date_done', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewNewVendors() {
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString().split('T')[0];

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'res.partner',
            name: 'New Vendors',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['supplier_rank', '>', 0],
                ['create_date', '>=', monthStartStr],
            ],
            context: { create: false },
        });
    }

    async onViewAvgIndentToPO() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.request',
            name: 'Purchase Requests',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['date_start', '>=', this.state.dateFrom],
                ['date_start', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewAvgPOToReceipt() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: 'Purchase Orders - Receipt Timeline',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['purchase', 'done']],
                ['date_approve', '>=', this.state.dateFrom],
                ['date_approve', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewAvgConsumptionCycle() {
        if (this.state.consumptionByProduct.length === 0) {
            return;
        }

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order.line',
            name: 'Consumption Cycle Analysis',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['order_id.state', 'in', ['purchase', 'done']],
                ['order_id.date_order', '>=', this.state.dateFrom],
                ['order_id.date_order', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    // Chart "View All" Handlers
    async onViewMonthlyPOStatus() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: 'Monthly Procurement Status',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewGRNRecords() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: 'GRN Records',
            views: [[false, 'list'], [false, 'form'], [false, 'pivot']],
            domain: [
                ['picking_type_code', '=', 'incoming'],
                ['state', '=', 'done'],
                ['date_done', '>=', this.state.dateFrom],
                ['date_done', '<=', this.state.dateTo],
            ],
            context: {
                create: false,
                group_by: ['date_done:month'],
            },
        });
    }

    async onViewPORelease() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: 'PO Release Analysis',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewDepartmentInventory() {
        if (this.state.departmentInventory.length === 0) {
            return;
        }

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: 'Department-wise Inventory',
            views: [[false, 'list'], [false, 'form'], [false, 'pivot']],
            domain: [
                ['picking_type_code', '=', 'internal'],
                ['state', '=', 'done'],
                ['issue_department_id', '!=', false],
            ],
            context: {
                create: false,
                group_by: ['issue_department_id'],
            },
        });
    }

    async onViewCommoditySpend() {
        if (this.state.commoditySpend.length === 0) {
            return;
        }

        // Get all category IDs from the commodity spend data
        const categoryIds = this.state.commoditySpend.map(c => {
            // Extract category ID if stored, otherwise we'll show all products
            return c.categoryId;
        }).filter(id => id); // Remove undefined

        // If we have category IDs, filter by them, otherwise show all products with POs
        const domain = categoryIds.length > 0
            ? [['categ_id', 'in', categoryIds]]
            : [['purchase_ok', '=', true]];

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.template',
            name: 'Products by Category - Spend Analysis',
            views: [[false, 'list'], [false, 'form']],
            domain: domain,
            context: {
                create: false,
                group_by: ['categ_id'],
            },
        });
    }

    async onViewPOEvaluation() {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: 'PO Evaluation - Planned vs Released',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewConsumptionCycle() {
        if (this.state.consumptionByProduct.length === 0) {
            return;
        }

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.product',
            name: 'Product Consumption Cycle',
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }

    async onViewInventoryNotMoved(days) {
        if (this.state.notMovedDetails.length === 0) {
            return;
        }

        const products = this.state.notMovedDetails
            .filter(p => p.daysNotMoved >= days)
            .map(p => p.productId);

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.product',
            name: `Inventory Not Moved (${days}+ days)`,
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', products]],
            context: { create: false },
        });
    }

    // Initialize all charts
    async initializeCharts() {
        console.log("=== INITIALIZING CHARTS ===");

        try {
            // Load Chart.js
            if (typeof Chart === 'undefined') {
                console.log("Loading Chart.js...");
                await loadJS("https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js");
                console.log("Chart.js loaded successfully");
            } else {

                console.log("Chart.js already loaded");
            }
                    // Wait for DOM to be ready
            await new Promise(resolve => setTimeout(resolve, 500));

            // Create all charts
            await this.createAllCharts();

        } catch (error) {
            console.error("ERROR initializing charts:", error);
        }
    }


    async createAllCharts() {
        console.log("Creating all charts...");

        if (typeof Chart === 'undefined') {
            console.error("Chart.js is not loaded!");
            return;
        }

        try {
            this.createTopSuppliersChart();
            this.createMonthlyPOChart();
            this.createMonthlyValuesChart();
            this.createMonthlyPOStatusChart();
            this.createMonthlyGRNChart();
            this.createCommodityChart();
            this.createConsumptionChart();
            this.createDepartmentInventoryChart();
            console.log("All charts created successfully");
        } catch (error) {
            console.error("Error creating charts:", error);
        }
    }

    destroyAllCharts() {
        console.log("Destroying existing charts...");
        Object.keys(this.charts).forEach(key => {
            if (this.charts[key]) {
                try {
                    this.charts[key].destroy();
                    this.charts[key] = null;
                } catch (e) {
                    console.error(`Error destroying ${key} chart:`, e);
                }
            }
        });
    }

    createTopSuppliersChart() {
        const canvas = document.getElementById('topSuppliersChart');
        if (!canvas) {
            console.log("Canvas 'topSuppliersChart' not found");
            return;
        }

        if (this.state.topSuppliers.length === 0) {
            console.log("No supplier data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.topSuppliers) {
            this.charts.topSuppliers.destroy();
        }

        console.log("Creating top suppliers chart...");

        this.charts.topSuppliers = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: this.state.topSuppliers.map(s => s.name),
                datasets: [{
                    label: 'Total Spend',
                    data: this.state.topSuppliers.map(s => s.totalSpend),
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderColor: 'rgba(59, 130, 246, 1)',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return 'Spend: ' + this.formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => this.formatCurrency(value)
                        }
                    },
                    y: {
                        ticks: {
                            maxRotation: 0,
                            minRotation: 0
                        }
                    }
                }
            }
        });

        console.log("Top suppliers chart created");
    }


    createMonthlyPOChart() {
        const canvas = document.getElementById('monthlyPOChart');
        if (!canvas) {
            console.log("Canvas 'monthlyPOChart' not found");
            return;
        }

        if (this.state.monthlyReleasePO.length === 0) {
            console.log("No monthly PO data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.monthlyPO) {
            this.charts.monthlyPO.destroy();
        }

        console.log("Creating monthly PO chart...");

        this.charts.monthlyPO = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.state.monthlyReleasePO.map(m => m.month),
                datasets: [
                    {
                        label: 'Planned',
                        data: this.state.monthlyReleasePO.map(m => m.planned),
                        borderColor: 'rgba(245, 158, 11, 1)',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                    },
                    {
                        label: 'Released',
                        data: this.state.monthlyReleasePO.map(m => m.released),
                        borderColor: 'rgba(16, 185, 129, 1)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        }
                    }
                }
            }
        });

        console.log("Monthly PO chart created");
    }

    createMonthlyValuesChart() {
        const canvas = document.getElementById('monthlyValuesChart');
        if (!canvas) {
            console.log("Canvas 'monthlyValuesChart' not found");
            return;
        }

        if (this.state.monthlyPOValues.length === 0) {
            console.log("No monthly values data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.monthlyValues) {
            this.charts.monthlyValues.destroy();
        }

        console.log("Creating monthly values chart...");

        this.charts.monthlyValues = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: this.state.monthlyPOValues.map(m => m.month),
                datasets: [
                    {
                        label: 'Planned Value',
                        data: this.state.monthlyPOValues.map(m => m.plannedValue),
                        backgroundColor: 'rgba(245, 158, 11, 0.8)',
                        borderColor: 'rgba(245, 158, 11, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                    },
                    {
                        label: 'Actual Value',
                        data: this.state.monthlyPOValues.map(m => m.actualValue),
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return context.dataset.label + ': ' + this.formatCurrency(context.parsed.y);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (value) => this.formatCurrency(value)
                        }
                    }
                }
            }
        });

        console.log("Monthly values chart created");
    }

    createMonthlyPOStatusChart() {
        const canvas = document.getElementById('monthlyPOStatusChart');
        if (!canvas) {
            console.log("Canvas 'monthlyPOStatusChart' not found");
            return;
        }

        if (this.state.monthlyPOStatus.length === 0) {
            console.log("No monthly PO status data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.monthlyPOStatus) {
            this.charts.monthlyPOStatus.destroy();
        }

        console.log("Creating monthly PO status chart...");

        const monthCount = this.state.monthlyPOStatus.length;
        const minBarWidth = 40;
        const calculatedWidth = Math.max(100, monthCount * minBarWidth);

        const chartContainer = canvas.parentElement;
        chartContainer.style.minWidth = `${calculatedWidth}%`;

        this.charts.monthlyPOStatus = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: this.state.monthlyPOStatus.map(m => m.month),
                datasets: [
                    {
                        label: 'Approved',
                        data: this.state.monthlyPOStatus.map(m => m.approved),
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        barThickness: 'flex',
                        maxBarThickness: 60,
                    },
                    {
                        label: 'Pending',
                        data: this.state.monthlyPOStatus.map(m => m.pending),
                        backgroundColor: 'rgba(245, 158, 11, 0.8)',
                        borderColor: 'rgba(245, 158, 11, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        barThickness: 'flex',
                        maxBarThickness: 60,
                    },
                    {
                        label: 'Indent',
                        data: this.state.monthlyPOStatus.map(m => m.indent),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderColor: 'rgba(59, 130, 246, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        barThickness: 'flex',
                        maxBarThickness: 60,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                        align: 'center',
                        labels: {
                            boxWidth: 15,
                            padding: 20,
                            font: {
                                size: 13,
                                weight: '600'
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: {
                            display: true,
                            drawOnChartArea: true,
                            drawTicks: true,
                            color: function(context) {
                                // Draw vertical lines between months
                                return 'rgba(0, 0, 0, 0.1)';
                            },
                            lineWidth: 1
                        },
                        ticks: {
                            font: {
                                size: 12,
                                weight: '500'
                            }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            precision: 0
                        },
                        grid: {
                            color: 'rgba(0, 0, 0, 0.05)',
                            lineWidth: 1
                        }
                    }
                }
            }
        });

        console.log("Monthly PO status chart created");
    }

    createMonthlyGRNChart() {
        const canvas = document.getElementById('monthlyGRNChart');
        if (!canvas) {
            console.log("Canvas 'monthlyGRNChart' not found");
            return;
        }

        if (this.state.monthlyGRN.length === 0) {
            console.log("No monthly GRN data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.monthlyGRN) {
            this.charts.monthlyGRN.destroy();
        }

        console.log("Creating monthly GRN chart...");

        this.charts.monthlyGRN = new Chart(ctx, {
            type: 'line',
            data: {
                labels: this.state.monthlyGRN.map(m => m.month),
                datasets: [
                    {
                        label: 'GRN Count',
                        data: this.state.monthlyGRN.map(m => m.count),
                        borderColor: 'rgba(16, 185, 129, 1)',
                        backgroundColor: 'rgba(16, 185, 129, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                        yAxisID: 'y',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'top',
                    },
                    tooltip: {
                        callbacks: {
                            afterLabel: (context) => {
                                const index = context.dataIndex;
                                const value = this.state.monthlyGRN[index].value;
                                return 'Value: ' + this.formatCurrency(value);
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        position: 'left',
                        ticks: {
                            precision: 0
                        },
                        title: {
                            display: true,
                            text: 'GRN Count'
                        }
                    }
                }
            }
        });

        console.log("Monthly GRN chart created");
    }

    createCommodityChart() {
        const canvas = document.getElementById('commodityChart');
        if (!canvas) {
            console.log("Canvas 'commodityChart' not found");
            return;
        }

        if (this.state.commoditySpend.length === 0) {
            console.log("No commodity data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.commodity) {
            this.charts.commodity.destroy();
        }

        const topCategories = this.state.commoditySpend.slice(0, 10);
        console.log("Creating commodity chart...");

        this.charts.commodity = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: topCategories.map(c => c.category),
                datasets: [{
                    data: topCategories.map(c => c.totalSpend),
                    backgroundColor: [
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(236, 72, 153, 0.8)',
                        'rgba(6, 182, 212, 0.8)',
                        'rgba(251, 146, 60, 0.8)',
                        'rgba(34, 197, 94, 0.8)',
                        'rgba(168, 85, 247, 0.8)',
                    ],
                    borderWidth: 2,
                    borderColor: '#fff',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = this.formatCurrency(context.parsed);
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((context.parsed / total) * 100).toFixed(1);
                                return `${label}: ${value} (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        console.log("Commodity chart created");
    }

    createDepartmentInventoryChart() {
        const canvas = document.getElementById('departmentInventoryChart');
        if (!canvas) {
            console.log("Canvas 'departmentInventoryChart' not found");
            return;
        }

        if (this.state.departmentInventory.length === 0) {
            console.log("No department inventory data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.departmentInventory) {
            this.charts.departmentInventory.destroy();
        }

        console.log("Creating department inventory chart...");

        this.charts.departmentInventory = new Chart(ctx, {
            type: 'pie',  // Changed from 'bar' to 'pie'
            data: {
                labels: this.state.departmentInventory.map(d => d.name),
                datasets: [{
                    label: 'Product Count',
                    data: this.state.departmentInventory.map(d => d.productCount),
                    backgroundColor: [
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(236, 72, 153, 0.8)',
                        'rgba(6, 182, 212, 0.8)',
                        'rgba(251, 146, 60, 0.8)',
                        'rgba(34, 197, 94, 0.8)',
                        'rgba(168, 85, 247, 0.8)',
                    ],
                    borderColor: '#fff',
                    borderWidth: 2,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'right',
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const label = context.label || '';
                                const value = context.parsed;
                                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                                const percentage = ((value / total) * 100).toFixed(1);
                                return `${label}: ${value} products (${percentage}%)`;
                            }
                        }
                    }
                }
            }
        });

        console.log("Department inventory chart created");
    }

    createConsumptionChart() {
        const canvas = document.getElementById('consumptionChart');
        if (!canvas) {
            console.log("Canvas 'consumptionChart' not found");
            return;
        }

        if (this.state.consumptionByProduct.length === 0) {
            console.log("No consumption data for chart");
            return;
        }

        const ctx = canvas.getContext('2d');

        if (this.charts.consumption) {
            this.charts.consumption.destroy();
        }

        const topProducts = this.state.consumptionByProduct.slice(0, 10);
        console.log("Creating consumption chart...");

        this.charts.consumption = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: topProducts.map(p => p.productName),
                datasets: [{
                    label: 'Days',
                    data: topProducts.map(p => parseFloat(p.avgDays)),
                    backgroundColor: topProducts.map(p => {
                        const days = parseFloat(p.avgDays);
                        if (days > 30) return 'rgba(239, 68, 68, 0.8)';
                        if (days > 15) return 'rgba(245, 158, 11, 0.8)';
                        return 'rgba(16, 185, 129, 0.8)';
                    }),
                    borderRadius: 6,
                    borderWidth: 0,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return 'Avg Days: ' + context.parsed.x.toFixed(1);
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        beginAtZero: true,
                        title: {
                            display: true,
                            text: 'Average Days (Order to Receipt)'
                        }
                    }
                }
            }
        });

        console.log("Consumption chart created");
    }
}

registry.category("actions").add("purchase_dashboard", PurchaseDashboard);