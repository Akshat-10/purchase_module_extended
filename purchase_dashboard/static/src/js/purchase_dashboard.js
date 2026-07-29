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
            monthlyPOSummary: [],
            monthlyPOStatus: [],
            monthlyGRN: [],
            monthlyTargets: {},
            topPurchasers: [],
            grnClearedCount: 0,
            notMoved30: 0,
            notMoved45: 0,
            notMoved60: 0,
            avgConsumptionCycle: 0,
            notMovedDetails: [],
            avgPOToReceipt: 0,
            avgIndentToPO: 0,
            consumptionByProduct: [],
            departmentConsumption: [],
            departmentInventory: [],
            commoditySpend: [],
            monthlyProductionInventory: [],
            dateFrom: this.getYearStart(),
            dateTo: this.getCurrentDate(),
            companyId: null,
            isLoading: false,
        });

        this.charts = {
            topSuppliers: null,
            monthlyPO: null,
            monthlyValues: null,
            monthlyPOStatus: null,
            monthlyGRN: null,
            commodity: null,
            consumption: null,
            topPurchasers: null,
            departmentInventory: null,
            inventoryTrend: null,
            productionInventory: null,
        };

        onWillStart(async () => {
            await this.loadMonthlyTargets();
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
                this.loadTopPurchasers(),
                this.loadPOToReceiptFromBackend(),
                this.loadConsumptionCycleMetric(),
                this.loadProductionInventoryMetrics(),
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
            this.state.totalSpendYearly = result.reduce((sum, po) => sum + (po.amount_total || 0), 0);

            const quants = await this.orm.searchRead(
                "stock.quant",
                [
                    ['quantity', '>', 0],
                    ['location_id.usage', '=', 'internal'],
                    ['create_date', '>=', this.state.dateFrom],
                    ['create_date', '<=', this.state.dateTo],
                ],
                ['value'],
                { limit: 100000 }
            );

            if (quants.length > 0) {
                this.state.totalInventoryCost = quants.reduce((sum, q) => sum + (q.value || 0), 0);
            } else {
                this.state.totalInventoryCost = 0;
                console.warn("No stock quants found for selected date range");
            }

            console.log("Total PO Spend:", this.formatCurrency(this.state.totalSpendYearly));
            console.log("Total Inventory Cost:", this.formatCurrency(this.state.totalInventoryCost));

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

            const newVendors = await this.orm.searchCount(
                "res.partner",
                [
                    ['supplier_rank', '>', 0],
                    ['create_date', '>=', this.state.dateFrom],
                    ['create_date', '<=', this.state.dateTo],
                ]
            );
            this.state.newVendorsCount = newVendors;

        } catch (error) {
            console.error("Error loading supplier data:", error);
        }
    }

    async loadPOMetrics() {
        try {
            const productCount = await this.orm.searchCount(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.date_approve', '>=', this.state.dateFrom],
                    ['order_id.date_approve', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                    ['display_type', '=', false],
                ]
            );
            this.state.itemsWithPO = productCount;

            await this.loadMonthlyPOStatus();
            await this.loadMonthlyPOSummary();

        } catch (error) {
            console.error("Error loading PO metrics:", error);
        }
    }

    async loadMonthlyPOSummary() {
        try {
            const summaryData = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['__count', 'amount_total:sum'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            const monthlyDict = {};

            summaryData.forEach(item => {
                const month = item['date_order:month'];
                const state = item.state;
                const count = item.__count || 0;
                const value = item.amount_total || 0;

                if (!month) return;

                if (!monthlyDict[month]) {
                    monthlyDict[month] = {
                        month: month,
                        plannedCount: 0,
                        plannedValue: 0,
                        releasedCount: 0,
                        actualValue: 0,
                    };
                }

                if (state === 'draft' || state === 'sent') {
                    monthlyDict[month].plannedCount += count;
                    monthlyDict[month].plannedValue += value;
                }
                else if (state === 'to approve' || state === 'purchase' || state === 'done') {
                    monthlyDict[month].releasedCount += count;
                    monthlyDict[month].actualValue += value;
                }
            });

            this.state.monthlyPOSummary = Object.values(monthlyDict)
                .sort((a, b) => new Date(a.month + '-01') - new Date(b.month + '-01'))
                .map(data => ({
                    month: data.month,
                    plannedCount: data.plannedCount,
                    releasedCount: data.releasedCount,
                    plannedValue: data.plannedValue,
                    actualValue: data.actualValue,
                    plannedDisplay: `${data.plannedCount} (${this.formatCurrency(data.plannedValue)})`,
                    releasedDisplay: `${data.releasedCount} (${this.formatCurrency(data.actualValue)})`,
                }));

        } catch (error) {
            console.error('Error loading monthly PO summary:', error);
            this.state.monthlyPOSummary = [];
        }
    }

    async loadMonthlyPOStatus() {
        try {
            const allPOs = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            let indents = [];
            try {
                indents = await this.orm.readGroup(
                    "purchase.request",
                    [
                        ['date_start', '>=', this.state.dateFrom],
                        ['date_start', '<=', this.state.dateTo],
                        ['state', 'in', ['draft', 'to_approve', 'approved', 'in_progress', 'done']]
                    ],
                    ['__count'],
                    ['date_start:month'],
                    { lazy: false }
                );
            } catch (e) {
                console.warn("purchase.request module not available — indent count will be 0");
            }

            const monthlyStatus = {};

            allPOs.forEach(item => {
                const month = item['date_order:month'];
                const state = item.state;
                const count = item.__count || 0;
                if (!month) return;

                if (!monthlyStatus[month]) {
                    monthlyStatus[month] = { month, approved: 0, pending: 0, indent: 0 };
                }

                if (state === 'purchase' || state === 'done' || state === 'to approve') {
                    monthlyStatus[month].approved += count;
                } else if (state === 'draft' || state === 'sent') {
                    monthlyStatus[month].pending += count;
                }
            });

            indents.forEach(item => {
                const month = item['date_start:month'];
                const count = item.__count || 0;
                if (!month) return;
                if (!monthlyStatus[month]) {
                    monthlyStatus[month] = { month, approved: 0, pending: 0, indent: 0 };
                }
                monthlyStatus[month].indent += count;
            });

            this.state.monthlyPOStatus = Object.values(monthlyStatus)
                .sort((a, b) => new Date(a.month + '-01') - new Date(b.month + '-01'));

        } catch (error) {
            console.error("Error loading monthly PO status:", error);
            this.state.monthlyPOStatus = [];
        }
    }

    async loadGRNMetrics() {
        try {
            const GRN_STATES = ['draft', 'waiting', 'confirmed', 'assigned', 'done'];

            const grnPickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', 'in', GRN_STATES],
                    ['create_date', '>=', this.state.dateFrom],
                    ['create_date', '<=', this.state.dateTo],
                ],
                ['id', 'name', 'create_date', 'date_done', 'state', 'move_ids_without_package','total_cost'],
                { limit: 10000 }
            );

            console.log(`GRN Pickings found: ${grnPickings.length}`);

            this.state.grnClearedCount = grnPickings.length;

            if (grnPickings.length === 0) {
                this.state.monthlyGRN = [];
                return;
            }

            const monthlyDict = {};

            grnPickings.forEach(picking => {
                const d = new Date(picking.create_date);
                const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                const state = picking.state;

                if (!monthlyDict[monthKey]) {
                    monthlyDict[monthKey] = {
                        month: monthKey,
                        total: 0,
                        draft: 0,       // Draft
                        waiting: 0,     // Waiting Another Operation
                        confirmed: 0,   // Waiting (products)
                        assigned: 0,    // Ready
                        done: 0,        // Done
                        totalCost: 0,
                    };
                }

                monthlyDict[monthKey].total += 1;
                monthlyDict[monthKey][state] = (monthlyDict[monthKey][state] || 0) + 1;
            });

            const allMoveIds = [];
            grnPickings.forEach(picking => {
                if (picking.move_ids_without_package) {
                    allMoveIds.push(...picking.move_ids_without_package);
                }
            });

            if (allMoveIds.length > 0) {
                const moves = await this.orm.searchRead(
                    "stock.move",
                    [['id', 'in', allMoveIds]],
                    ['picking_id', 'product_id', 'product_uom_qty', 'purchase_line_id'],
                    { limit: 50000 }
                );

                const poLineIds = moves.filter(m => m.purchase_line_id).map(m => m.purchase_line_id[0]);
                const poLinePriceMap = {};
                if (poLineIds.length > 0) {
                    const poLines = await this.orm.searchRead(
                        "purchase.order.line",
                        [['id', 'in', poLineIds]],
                        ['id', 'price_unit']
                    );
                    poLines.forEach(line => { poLinePriceMap[line.id] = line.price_unit || 0; });
                }

                const productIds = [...new Set(moves.map(m => m.product_id[0]))];
                const products = await this.orm.searchRead(
                    "product.product",
                    [['id', 'in', productIds]],
                    ['id', 'standard_price']
                );
                const productPriceMap = {};
                products.forEach(p => { productPriceMap[p.id] = p.standard_price || 0; });

                const pickingCostMap = {};
                moves.forEach(move => {
                    const pickingId = move.picking_id[0];
                    const productId = move.product_id[0];
                    const qty = move.product_uom_qty || 0;
                    let price = move.purchase_line_id
                        ? (poLinePriceMap[move.purchase_line_id[0]] || 0)
                        : 0;
                    if (price === 0) price = productPriceMap[productId] || 0;
                    if (!pickingCostMap[pickingId]) pickingCostMap[pickingId] = 0;
                    pickingCostMap[pickingId] += qty * price;
                });

                grnPickings.forEach(picking => {
                    const d = new Date(picking.create_date);
                    const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
                    if (monthlyDict[monthKey]) {
                        monthlyDict[monthKey].totalCost += (picking.total_cost || 0);
                    }
                });
            }

            this.state.monthlyGRN = Object.values(monthlyDict)
                .sort((a, b) => new Date(a.month + '-01') - new Date(b.month + '-01'))
                .map(item => {
                    const [year, monthNum] = item.month.split('-');
                    const monthName = new Date(parseInt(year), parseInt(monthNum) - 1)
                        .toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    return {
                        month: monthName,
                        monthKey: item.month,
                        total: item.total,           // All non-cancelled
                        draft: item.draft,           // Draft
                        waiting: item.waiting,       // Waiting Another Operation
                        confirmed: item.confirmed,   // Waiting (products)
                        ready: item.assigned,        // Ready
                        done: item.done,             // Done
                        totalCost: item.totalCost,   // Total cost 
                    };
                });

            console.log('Monthly GRN Summary:', this.state.monthlyGRN);

        } catch (error) {
            console.error("Error loading GRN metrics:", error);
            this.state.grnClearedCount = 0;
            this.state.monthlyGRN = [];
        }
    }

    async loadCommodityData() {
        try {
            const poLines = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.date_approve', '>=', this.state.dateFrom],
                    ['order_id.date_approve', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                    ['display_type', '=', false],
                ],
                ['product_id', 'price_subtotal'],
                { limit: 100000 }
            );

            if (poLines.length === 0) {
                this.state.commoditySpend = [];
                console.warn("No PO lines found for commodity data");
                return;
            }

            const productIds = [...new Set(poLines.map(l => l.product_id[0]))];
            const products = await this.orm.searchRead(
                "product.product",
                [['id', 'in', productIds]],
                ['id', 'categ_id'],
                { limit: 50000 }
            );

            const productCategMap = {};
            products.forEach(p => {
                if (p.categ_id) {
                    productCategMap[p.id] = { id: p.categ_id[0], name: p.categ_id[1] };
                }
            });

            const categoryMap = {};
            poLines.forEach(line => {
                const productId = line.product_id[0];
                const categ = productCategMap[productId];
                if (!categ) return;

                const key = categ.id;
                if (!categoryMap[key]) {
                    categoryMap[key] = {
                        categoryId: categ.id,
                        category: categ.name,
                        totalSpend: 0,
                        products: new Set(),
                    };
                }
                categoryMap[key].totalSpend += (line.price_subtotal || 0);
                categoryMap[key].products.add(productId);
            });

            this.state.commoditySpend = Object.values(categoryMap)
                .map(c => ({
                    categoryId: c.categoryId,
                    category: c.category,
                    totalSpend: c.totalSpend,
                    productCount: c.products.size,
                }))
                .sort((a, b) => b.totalSpend - a.totalSpend);

            console.log("Commodity data loaded:", this.state.commoditySpend.length, "categories");

        } catch (error) {
            console.error("Error loading commodity data:", error);
            this.state.commoditySpend = [];
        }
    }

    async loadPOToReceiptFromBackend() {
        try {
            const pos = await this.orm.searchRead(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                ],
                ['id', 'date_approve', 'picking_ids']
            );

            if (!pos.length) {
                this.state.avgPOToReceipt = 0;
                return;
            }

            const allPickingIds = [];
            const poDateMap = {};
            const poPickingsMap = {};

            pos.forEach(po => {
                if (po.picking_ids && po.picking_ids.length) {
                    allPickingIds.push(...po.picking_ids);
                    po.picking_ids.forEach(pid => { poDateMap[pid] = po.date_approve; });
                }
                poPickingsMap[po.id] = po.picking_ids || [];
            });

            if (!allPickingIds.length) {
                this.state.avgPOToReceipt = 0;
                return;
            }

            const pickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['id', 'in', allPickingIds],
                    ['state', '=', 'done'],
                    ['picking_type_code', '=', 'incoming'],
                ],
                ['id', 'date_done']
            );

            const dayDiffs = [];
            pickings.forEach(picking => {
                const approveDate = poDateMap[picking.id];
                if (approveDate && picking.date_done) {
                    const diff = (new Date(picking.date_done) - new Date(approveDate)) / (1000 * 60 * 60 * 24);
                    if (diff >= 0 && diff < 365) {
                        dayDiffs.push(diff);
                    }
                }
            });

            this.state.avgPOToReceipt = dayDiffs.length > 0
                ? Math.round(dayDiffs.reduce((a, b) => a + b, 0) / dayDiffs.length)
                : 0;

            console.log("Avg PO to Receipt:", this.state.avgPOToReceipt, "days (from", dayDiffs.length, "receipts)");

        } catch (error) {
            console.error('Error computing PO to Receipt:', error);
            this.state.avgPOToReceipt = 0;
        }
    }

    async loadInventoryMetrics() {
        try {
            const today = new Date();

            const quants = await this.orm.searchRead(
                "stock.quant",
                [
                    ['quantity', '>', 0],
                    ['location_id.usage', '=', 'internal'],
                ],
                ['product_id', 'quantity', 'value'],
                { limit: 10000 }
            );

            if (quants.length === 0) {
                this.state.notMoved30 = 0;
                this.state.notMoved45 = 0;
                this.state.notMoved60 = 0;
                this.state.notMovedDetails = [];
                return;
            }

            const productIds = [...new Set(quants.map(q => q.product_id[0]))];

            const recentMoves = await this.orm.searchRead(
                "stock.move",
                [
                    ['product_id', 'in', productIds],
                    ['state', '=', 'done'],
                    ['location_id.usage', '=', 'internal'],
                    ['location_dest_id.usage', '!=', 'internal'],
                ],
                ['product_id', 'date'],
                { limit: 50000, order: 'date desc' }
            );

            const lastConsumeMap = {};
            recentMoves.forEach(move => {
                const prodId = move.product_id[0];
                const moveDate = new Date(move.date);
                if (!lastConsumeMap[prodId] || moveDate > lastConsumeMap[prodId]) {
                    lastConsumeMap[prodId] = moveDate;
                }
            });

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
                productQuantMap[prodId].totalValue += (q.value || 0);
            });

            let count30 = 0;
            let count45 = 0;
            let count60 = 0;
            const notMovedDetails = [];

            Object.values(productQuantMap).forEach(product => {
                const lastConsumeDate = lastConsumeMap[product.productId];
                let daysNotMoved;

                if (!lastConsumeDate) {
                    daysNotMoved = 9999;
                } else {
                    daysNotMoved = Math.floor((today - lastConsumeDate) / (1000 * 60 * 60 * 24));
                }

                if (daysNotMoved >= 30) {
                    count30++;
                    if (daysNotMoved >= 45) {
                        count45++;
                        if (daysNotMoved >= 60) {
                            count60++;
                        }
                    }
                    notMovedDetails.push({
                        productId: product.productId,
                        productName: product.productName,
                        lastMove: lastConsumeDate ? lastConsumeDate.toISOString().split('T')[0] : 'Never consumed',
                        daysNotMoved: daysNotMoved,
                        qty: product.totalQty,
                        value: product.totalValue,
                    });
                }
            });

            this.state.notMoved30 = count30;
            this.state.notMoved45 = count45;
            this.state.notMoved60 = count60;
            this.state.notMovedDetails = notMovedDetails.sort((a, b) => b.daysNotMoved - a.daysNotMoved);

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
            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ['product_id', '!=', false],
                    ['state', '=', 'done'],
                    ['location_id.usage', '=', 'internal'],
                    ['location_dest_id.usage', '!=', 'internal'],
                    ['date', '>=', this.state.dateFrom],
                    ['date', '<=', this.state.dateTo],
                ],
                ['product_id', 'picking_id', 'product_uom_qty', 'product_uom'],
                { limit: 50000 }
            );

            if (moves.length === 0) {
                this.state.consumptionByProduct = [];
                return;
            }

            const pickingIds = [...new Set(moves.map(m => m.picking_id[0]).filter(Boolean))];

            const pickingDeptMap = {};
            if (pickingIds.length > 0) {
                const pickings = await this.orm.searchRead(
                    "stock.picking",
                    [['id', 'in', pickingIds]],
                    ['id', 'issue_department_id'],
                    { limit: 10000 }
                );
                pickings.forEach(p => {
                    if (p.issue_department_id) {
                        pickingDeptMap[p.id] = {
                            deptId: p.issue_department_id[0],
                            deptName: p.issue_department_id[1],
                        };
                    }
                });
            }

            const productIds = [...new Set(moves.map(m => m.product_id[0]))];
            const products = await this.orm.searchRead(
                "product.product",
                [['id', 'in', productIds]],
                ['id', 'qty_available', 'uom_id'],
                { limit: 10000 }
            );

            const productInfoMap = {};
            products.forEach(p => {
                productInfoMap[p.id] = {
                    onHand: p.qty_available || 0,
                    uom: p.uom_id ? p.uom_id[1] : 'Unit',
                };
            });

            const productStats = {};
            moves.forEach(move => {
                const productId = move.product_id[0];
                const productName = move.product_id[1];
                const pickingId = move.picking_id ? move.picking_id[0] : null;
                const dept = pickingId ? pickingDeptMap[pickingId] : null;
                const qty = move.product_uom_qty || 0;
                const uom = productInfoMap[productId]?.uom || (move.product_uom ? move.product_uom[1] : 'Unit');

                if (!productStats[productId]) {
                    productStats[productId] = {
                        productId,
                        productName,
                        usageCount: 0,
                        totalQty: 0,
                        uom,
                        onHand: productInfoMap[productId]?.onHand || 0,
                        departments: {},
                    };
                }

                productStats[productId].usageCount += 1;
                productStats[productId].totalQty += qty;

                if (dept) {
                    const deptKey = `${dept.deptId}`;
                    if (!productStats[productId].departments[deptKey]) {
                        productStats[productId].departments[deptKey] = {
                            deptId: dept.deptId,
                            deptName: dept.deptName,
                            count: 0,
                            qty: 0,
                        };
                    }
                    productStats[productId].departments[deptKey].count += 1;
                    productStats[productId].departments[deptKey].qty += qty;
                }
            });

            this.state.consumptionByProduct = Object.values(productStats)
                .sort((a, b) => b.usageCount - a.usageCount)
                .slice(0, 20);

        } catch (error) {
            console.error("Error loading consumption metrics:", error);
            this.state.consumptionByProduct = [];
        }
    }

    async loadConsumptionCycleMetric() {
        try {
            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ['state', '=', 'done'],
                    ['product_id', '!=', false],
                    ['location_id.usage', '=', 'internal'],
                    ['location_dest_id.usage', '!=', 'internal'],
                    ['date', '>=', this.state.dateFrom],
                    ['date', '<=', this.state.dateTo],
                ],
                ['product_id', 'date'],
                { limit: 50000, order: 'product_id asc, date asc' }
            );

            if (!moves.length) {
                this.state.avgConsumptionCycle = 0;
                return;
            }

            const productDatesMap = {};
            moves.forEach(move => {
                const prodId = move.product_id[0];
                const moveDate = new Date(move.date);
                if (!productDatesMap[prodId]) productDatesMap[prodId] = [];
                productDatesMap[prodId].push(moveDate);
            });

            const productAvgGaps = [];
            Object.values(productDatesMap).forEach(dates => {
                if (dates.length < 2) return;
                dates.sort((a, b) => a - b);
                const gaps = [];
                for (let i = 1; i < dates.length; i++) {
                    const dayGap = Math.floor((dates[i] - dates[i - 1]) / 86400000);
                    if (dayGap > 0 && dayGap <= 365) gaps.push(dayGap);
                }
                if (gaps.length === 0) return;
                productAvgGaps.push(gaps.reduce((s, g) => s + g, 0) / gaps.length);
            });

            this.state.avgConsumptionCycle = productAvgGaps.length > 0
                ? Math.round(productAvgGaps.reduce((s, g) => s + g, 0) / productAvgGaps.length)
                : 0;

        } catch (error) {
            console.error("Error loading consumption cycle:", error);
            this.state.avgConsumptionCycle = 0;
        }
    }

    async loadTopPurchasers() {
        try {
            const topPurchasersData = await this.orm.readGroup(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                    ['user_id', '!=', false],
                ],
                ['user_id', 'amount_total:sum'],
                ['user_id'],
                { limit: 10, orderby: 'amount_total desc' }
            );

            this.state.topPurchasers = topPurchasersData.map(item => ({
                id: item.user_id[0],
                name: item.user_id[1],
                totalSpend: item.amount_total,
                poCount: item.user_id_count,
            }));

        } catch (error) {
            console.error("Error loading top purchasers:", error);
        }
    }

    async loadTimingMetrics() {
        try {
            let totalIndentToPODays = 0;
            let indentToPOCount = 0;

            try {
                const poLines = await this.orm.searchRead(
                    "purchase.order.line",
                    [['purchase_request_lines', '!=', false]],
                    ['id', 'order_id', 'purchase_request_lines'],
                    { limit: 1000 }
                );

                if (poLines.length > 0) {
                    const poIds = [...new Set(poLines.map(line => line.order_id[0]))];
                    const pos = await this.orm.searchRead(
                        "purchase.order",
                        [['id', 'in', poIds]],
                        ['id', 'name', 'date_order', 'date_approve']
                    );
                    const poMap = {};
                    pos.forEach(po => { poMap[po.id] = po; });

                    const allRequestLineIds = [];
                    poLines.forEach(line => {
                        if (line.purchase_request_lines) allRequestLineIds.push(...line.purchase_request_lines);
                    });

                    if (allRequestLineIds.length > 0) {
                        const requestLines = await this.orm.searchRead(
                            "purchase.request.line",
                            [['id', 'in', allRequestLineIds]],
                            ['id', 'request_id']
                        );
                        const requestIds = [...new Set(requestLines.map(rl => rl.request_id[0]))];
                        const requests = await this.orm.searchRead(
                            "purchase.request",
                            [['id', 'in', requestIds]],
                            ['id', 'name', 'date_start']
                        );
                        const requestMap = {};
                        requests.forEach(req => { requestMap[req.id] = req; });
                        const requestLineToRequest = {};
                        requestLines.forEach(rl => { requestLineToRequest[rl.id] = rl.request_id[0]; });

                        for (const line of poLines) {
                            try {
                                const po = poMap[line.order_id[0]];
                                if (!po || !line.purchase_request_lines?.length) continue;
                                const requestLineId = line.purchase_request_lines[0];
                                const requestId = requestLineToRequest[requestLineId];
                                const request = requestMap[requestId];
                                if (request && request.date_start && (po.date_order || po.date_approve)) {
                                    const diff = Math.floor(
                                        (new Date(po.date_order || po.date_approve) - new Date(request.date_start))
                                        / (1000 * 60 * 60 * 24)
                                    );
                                    if (diff >= 0 && diff < 365) {
                                        totalIndentToPODays += diff;
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
                console.warn("purchase.request module not available — indent to PO will be 0");
            }

            this.state.avgIndentToPO = indentToPOCount > 0
                ? (totalIndentToPODays / indentToPOCount).toFixed(2)
                : 0;

        } catch (error) {
            console.error("Error loading timing metrics:", error);
            this.state.avgIndentToPO = 0;
        }
    }

    async loadDepartmentInventory() {
        try {
            const pickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['state', '=', 'done'],
                    ['issue_department_id', '!=', false],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ],
                ['id', 'issue_department_id', 'move_ids_without_package'],
                { limit: 5000 }
            );

            if (pickings.length === 0) {
                this.state.departmentInventory = [];
                return;
            }

            const allMoveIds = [];
            pickings.forEach(p => {
                if (p.move_ids_without_package) allMoveIds.push(...p.move_ids_without_package);
            });

            if (allMoveIds.length === 0) {
                this.state.departmentInventory = [];
                return;
            }

            const moves = await this.orm.searchRead(
                "stock.move",
                [['id', 'in', allMoveIds]],
                ['picking_id', 'product_id', 'product_uom_qty', 'location_dest_id'],
                { limit: 50000 }
            );

            const productIds = [...new Set(moves.map(m => m.product_id[0]))];
            const products = await this.orm.searchRead(
                "product.product",
                [['id', 'in', productIds]],
                ['id', 'standard_price']
            );
            const productPriceMap = {};
            products.forEach(p => { productPriceMap[p.id] = p.standard_price || 0; });

            const internalLocs = await this.orm.searchRead(
                "stock.location",
                [['usage', '=', 'internal']],
                ['id']
            );
            const internalLocIds = new Set(internalLocs.map(l => l.id));

            const pickingDeptMap = {};
            pickings.forEach(p => {
                pickingDeptMap[p.id] = {
                    deptId: p.issue_department_id[0],
                    deptName: p.issue_department_id[1],
                };
            });

            const deptData = {};
            moves.forEach(move => {
                const pickingId = move.picking_id[0];
                const dept = pickingDeptMap[pickingId];
                if (!dept) return;
                if (!internalLocIds.has(move.location_dest_id[0])) return;

                const productId = move.product_id[0];
                const qty = move.product_uom_qty || 0;
                const value = qty * (productPriceMap[productId] || 0);

                if (!deptData[dept.deptId]) {
                    deptData[dept.deptId] = {
                        id: dept.deptId,
                        name: dept.deptName,
                        totalQty: 0,
                        totalCost: 0,
                        products: new Set(),
                    };
                }
                deptData[dept.deptId].products.add(productId);
                deptData[dept.deptId].totalQty += qty;
                deptData[dept.deptId].totalCost += value;
            });

            this.state.departmentInventory = Object.values(deptData)
                .map(d => ({
                    id: d.id,
                    name: d.name,
                    productCount: d.products.size,
                    totalQty: d.totalQty,
                    totalCost: d.totalCost,
                }))
                .sort((a, b) => b.totalCost - a.totalCost);

        } catch (error) {
            console.error("Error loading department inventory:", error);
            this.state.departmentInventory = [];
        }
    }
    async loadMonthlyTargets() {
        try {
            const targets = await this.orm.call('purchase.target', 'get_all_targets', []);
            this.state.monthlyTargets = targets || {};
            console.log('Targets loaded:', this.state.monthlyTargets);
        } catch (error) {
            console.warn('Could not load targets (purchase.target model may not exist):', error.message);
            this.state.monthlyTargets = {};
        }
    }

    async loadProductionInventoryMetrics() {
        try {
            console.log("=== MONTHLY INVENTORY TREND ===");

            const grnData = await this.orm.readGroup(
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

            const consumptionData = await this.orm.readGroup(
                "stock.move",
                [
                    ['state', '=', 'done'],
                    ['location_id.usage', '=', 'internal'],
                    ['location_dest_id.usage', '!=', 'internal'],
                    ['date', '>=', this.state.dateFrom],
                    ['date', '<=', this.state.dateTo],
                ],
                ['__count', 'product_uom_qty:sum'],
                ['date:month'],
                { lazy: false }
            );

            const inventoryValue = await this.orm.readGroup(
                "stock.quant",
                [
                    ['location_id.usage', '=', 'internal'],
                    ['quantity', '>', 0],
                    ['in_date', '>=', this.state.dateFrom],
                    ['in_date', '<=', this.state.dateTo],
                ],
                ['value:sum', 'quantity:sum'],
                ['in_date:month'],
                { lazy: false }
            );

            const monthlyDict = {};

            grnData.forEach(item => {
                const month = item['date_done:month'];
                if (!month) return;
                const key = this.normalizeMonthKey(month);
                if (!monthlyDict[key]) monthlyDict[key] = { grnCount: 0, productCount: 0, inventoryValue: 0 };
                monthlyDict[key].grnCount += item.__count || 0;
            });

            consumptionData.forEach(item => {
                const month = item['date:month'];
                if (!month) return;
                const key = this.normalizeMonthKey(month);
                if (!monthlyDict[key]) monthlyDict[key] = { grnCount: 0, productCount: 0, inventoryValue: 0 };
                monthlyDict[key].productCount += item.__count || 0;
            });

            inventoryValue.forEach(item => {
                const month = item['in_date:month'];
                if (!month) return;
                const key = this.normalizeMonthKey(month);
                if (!monthlyDict[key]) monthlyDict[key] = { grnCount: 0, productCount: 0, inventoryValue: 0 };
                monthlyDict[key].inventoryValue += item.value || 0;
            });

            if (Object.keys(monthlyDict).length === 0) {
                this.state.monthlyProductionInventory = [];
                this.createProductionInventoryChart();
                return;
            }

            this.state.monthlyProductionInventory = Object.keys(monthlyDict)
                .sort()
                .map(key => {
                    const [year, monthNum] = key.split('-');
                    const label = new Date(parseInt(year), parseInt(monthNum) - 1)
                        .toLocaleString('en-US', { month: 'long', year: 'numeric' });
                    return {
                        month: label,
                        monthKey: key,
                        grnCount: monthlyDict[key].grnCount,
                        productCount: monthlyDict[key].productCount,
                        inventoryValue: monthlyDict[key].inventoryValue,
                    };
                });

            console.log("Monthly inventory trend:", this.state.monthlyProductionInventory);
            await new Promise(resolve => setTimeout(resolve, 100));
            this.createProductionInventoryChart();

        } catch (error) {
            console.error("Error loading monthly inventory metrics:", error);
            this.state.monthlyProductionInventory = [];
            this.createProductionInventoryChart();
        }
    }

    getTargetForMonth(month) {
        const key = this.normalizeMonthKey(month);
        return (this.state.monthlyTargets && this.state.monthlyTargets[key]) || '';
    }

    normalizeMonthKey(month) {
        try {
            if (/^\d{4}-\d{2}$/.test(month)) return month;
            const monthNames = {
                'january': '01', 'february': '02', 'march': '03', 'april': '04',
                'may': '05', 'june': '06', 'july': '07', 'august': '08',
                'september': '09', 'october': '10', 'november': '11', 'december': '12'
            };
            const match = month.match(/^([A-Za-z]+)\s+(\d{4})$/);
            if (match) {
                const monthNum = monthNames[match[1].toLowerCase()];
                if (monthNum) return `${match[2]}-${monthNum}`;
            }
            return month;
        } catch (e) {
            return month;
        }
    }

    refreshMonthlyValuesChart() {
        if (this.charts.monthlyValues) {
            try { this.charts.monthlyValues.destroy(); } catch (e) {}
        }
        this.createMonthlyValuesChartWithTarget();
    }

    async onTargetInputChange(ev) {
        const rawMonth = ev.target.dataset.month;
        const value = ev.target.value;

        const month = this.normalizeMonthKey(rawMonth);
        console.log('Saving target — raw:', rawMonth, '→ normalized:', month, 'value:', value);

        try {
            const result = await this.orm.call(
                'purchase.target', 'set_target', [month, parseFloat(value || 0)]
            );
            if (result.success) {
                if (!this.state.monthlyTargets) this.state.monthlyTargets = {};
                this.state.monthlyTargets[month] = parseFloat(value || 0);
                console.log('Updated monthlyTargets:', JSON.stringify(this.state.monthlyTargets));
                this.refreshMonthlyValuesChart();
            } else {
                alert('❌ ' + result.message);
            }
        } catch (error) {
            console.error('Error updating target:', error);
            alert('Failed to update target: ' + error.message);
        }
    }

    createMonthlyValuesChartWithTarget() {
        const canvas = document.getElementById('monthlyValuesChart');
        if (!canvas || this.state.monthlyPOSummary.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts.monthlyValues) {
            try { this.charts.monthlyValues.destroy(); } catch (e) {}
        }

        const months = this.state.monthlyPOSummary.map(m => m.month);
        const poReleasedValues = this.state.monthlyPOSummary.map(m => m.actualValue);

        const targetValues = this.state.monthlyPOSummary.map(m => {
            const normalizedKey = this.normalizeMonthKey(m.month);
            const target = Number(
                this.state.monthlyTargets[normalizedKey] ||
                this.state.monthlyTargets[m.month] ||
                0
            );
            return target;
        });

        const greenValues = poReleasedValues.map((released, idx) => {
            const target = targetValues[idx];
            if (!target || target <= 0) return released;
            return Math.min(released, target);
        });

        const redValues = poReleasedValues.map((released, idx) => {
            const target = targetValues[idx];
            if (!target || target <= 0) return 0;
            return Math.max(0, released - target);
        });

        this.charts.monthlyValues = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: months,
                datasets: [
                    {
                        label: 'PO Released (Within Target)',
                        data: greenValues,
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        borderWidth: 1,
                        borderRadius: 0,
                        yAxisID: 'y',
                        stack: 'poReleased',
                    },
                    {
                        label: 'PO Released (Over Target)',
                        data: redValues,
                        backgroundColor: 'rgba(239, 68, 68, 0.8)',
                        borderColor: 'rgba(239, 68, 68, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: 'y',
                        stack: 'poReleased',
                    },
                    {
                        label: 'RFQ',
                        data: this.state.monthlyPOSummary.map(m => m.plannedValue),
                        backgroundColor: 'rgba(245, 158, 11, 0.8)',
                        borderColor: 'rgba(245, 158, 11, 1)',
                        borderWidth: 1,
                        borderRadius: 6,
                        yAxisID: 'y',
                        stack: 'rfq',
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false,
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            filter: (item) => {
                                if (item.text === 'PO Released (Over Target)') {
                                    return redValues.some(v => v > 0);
                                }
                                return true;
                            }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const value = context.parsed.y;
                                if (value === 0) return null;
                                return `${context.dataset.label}: ${this.formatCurrency(value)}`;
                            },
                            afterBody: (contexts) => {
                                const idx = contexts[0]?.dataIndex;
                                if (idx === undefined) return [];
                                const target = targetValues[idx];
                                const released = poReleasedValues[idx];
                                if (!target || target <= 0) return [];
                                const lines = ['─────────────────'];
                                lines.push(`Target:   ${this.formatCurrency(target)}`);
                                lines.push(`Released: ${this.formatCurrency(released)}`);
                                const diff = released - target;
                                if (diff > 0) {
                                    lines.push(`Over by:  ${this.formatCurrency(diff)}`);
                                } else if (diff < 0) {
                                    lines.push(`Under by: ${this.formatCurrency(Math.abs(diff))}`);
                                } else {
                                    lines.push(`Exactly on target ✓`);
                                }
                                return lines;
                            }
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        ticks: {
                            callback: (v) => this.formatCurrency(v)
                        },
                        grid: {
                            color: 'rgba(0,0,0,0.06)'
                        }
                    },
                    x: {
                        ticks: { color: '#000000' },
                        grid: { display: false }
                    }
                }
            }
        });
    }

    formatCurrency(value) {
        value = value || 0;
        if (value >= 10000000) return '₹' + (value / 10000000).toFixed(2) + ' Cr';
        if (value >= 100000) return '₹' + (value / 100000).toFixed(2) + ' L';
        if (value >= 1000) return '₹' + (value / 1000).toFixed(2) + ' K';
        return '₹' + value.toFixed(2);
    }

    formatNumber(value) {
        return new Intl.NumberFormat('en-IN').format(value || 0);
    }

    async onRefreshDashboard() {
        this.destroyAllCharts();
        await this.loadMonthlyTargets();
        await this.loadDashboardData();
        await new Promise(resolve => setTimeout(resolve, 300));
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
            buttonElement = ev.target.closest("button");
            const originalHTML = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Generating...';
            buttonElement.disabled = true;

            if (typeof html2canvas === "undefined") {
                await loadJS("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
                await new Promise(r => setTimeout(r, 500));
            }
            if (!window.jspdf || !window.jspdf.jsPDF) throw new Error("jsPDF not loaded");

            const { jsPDF } = window.jspdf;
            const dashboardContent =
                document.querySelector(".o_com_purchase_dashboard") ||
                document.querySelector(".o_action_manager .o_content");
            if (!dashboardContent) throw new Error("Dashboard content not found");

            const pageBreakEl = dashboardContent.querySelector(".pdf-page-break");
            let pageBreakPixel = null;
            if (pageBreakEl) {
                const dashboardRect = dashboardContent.getBoundingClientRect();
                const breakRect = pageBreakEl.getBoundingClientRect();
                pageBreakPixel = (breakRect.top - dashboardRect.top) + dashboardContent.scrollTop;
            }

            const SCALE = 2.5;
            const canvas = await html2canvas(dashboardContent, {
                scale: SCALE,
                useCORS: true,
                backgroundColor: "#ffffff",
                scrollX: 0,
                scrollY: 0,
                windowWidth: dashboardContent.scrollWidth,
                windowHeight: dashboardContent.scrollHeight,
            });

            let breakY = pageBreakPixel !== null
                ? Math.round(pageBreakPixel * (canvas.height / dashboardContent.scrollHeight))
                : Math.round(canvas.height / 2);
            breakY = Math.max(1, Math.min(breakY, canvas.height - 1));

            const pdf = new jsPDF("p", "mm", "a4");
            const pageWidth = pdf.internal.pageSize.getWidth();
            const margin = 10;
            const usableWidth = pageWidth - margin * 2;

            const page1Canvas = document.createElement("canvas");
            page1Canvas.width = canvas.width;
            page1Canvas.height = breakY;
            page1Canvas.getContext("2d").drawImage(canvas, 0, 0, canvas.width, breakY, 0, 0, canvas.width, breakY);

            const page2Canvas = document.createElement("canvas");
            page2Canvas.width = canvas.width;
            page2Canvas.height = canvas.height - breakY;
            page2Canvas.getContext("2d").drawImage(canvas, 0, breakY, canvas.width, canvas.height - breakY, 0, 0, canvas.width, canvas.height - breakY);

            pdf.addImage(page1Canvas.toDataURL("image/jpeg", 1.0), "JPEG", margin, margin, usableWidth, (page1Canvas.height * usableWidth) / page1Canvas.width);
            pdf.addPage();
            pdf.addImage(page2Canvas.toDataURL("image/jpeg", 1.0), "JPEG", margin, margin, usableWidth, (page2Canvas.height * usableWidth) / page2Canvas.width);

            const now = new Date();
            pdf.save(`Purchase_Dashboard_${now.toISOString().split("T")[0]}.pdf`);

            buttonElement.innerHTML = originalHTML;
            buttonElement.disabled = false;

        } catch (err) {
            console.error("PDF Error:", err);
            alert("PDF generation failed: " + err.message);
            if (buttonElement) {
                buttonElement.innerHTML = '<i class="fa fa-download"></i> Download';
                buttonElement.disabled = false;
            }
        }
    }

    async onViewTopSuppliers() {
        if (!this.state.topSuppliers.length) return;
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'res.partner', name: 'Top Suppliers',
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', this.state.topSuppliers.map(s => s.id)]],
            context: { create: false },
        });
    }

    async onViewTotalPOs() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.order', name: 'Purchase Orders',
            views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['purchase', 'done']], ['date_approve', '>=', this.state.dateFrom], ['date_approve', '<=', this.state.dateTo]],
            context: { create: false },
        });
    }

    async onViewTotalInventory() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.quant', name: 'Inventory',
            views: [[false, 'list'], [false, 'form']],
            domain: [['quantity', '>', 0], ['location_id.usage', '=', 'internal']],
            context: { create: false },
        });
    }

    async onViewItemsWithPO() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.order.line',
            name: 'Products with Purchase Orders',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['order_id.state', 'in', ['purchase', 'done']],
                ['order_id.date_approve', '>=', this.state.dateFrom],
                ['order_id.date_approve', '<=', this.state.dateTo],
                ['product_id', '!=', false],
            ],
            context: { create: false },
        });
    }

    async onViewGRNCleared() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.picking', name: 'GRN Receipts',
            views: [[false, 'list'], [false, 'form']],
            domain: [
                [("picking_type_code", "=", "incoming")],
                ['state', 'in', ['draft', 'waiting', 'confirmed', 'assigned', 'done']],
                ['create_date', '>=', this.state.dateFrom],
                ['create_date', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewNewVendors() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'res.partner', name: 'New Vendors',
            views: [[false, 'list'], [false, 'form']],
            domain: [['supplier_rank', '>', 0], ['create_date', '>=', this.state.dateFrom], ['create_date', '<=', this.state.dateTo]],
            context: { create: false },
        });
    }

    async onViewAvgIndentToPO() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.request', name: 'Purchase Requests',
            views: [[false, 'list'], [false, 'form']],
            domain: [['date_start', '>=', this.state.dateFrom], ['date_start', '<=', this.state.dateTo]],
            context: { create: false },
        });
    }

    async onViewAvgPOToReceipt() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.order', name: 'Purchase Orders - Receipt Timeline',
            views: [[false, 'list'], [false, 'form']],
            domain: [['state', 'in', ['purchase', 'done']], ['date_approve', '>=', this.state.dateFrom], ['date_approve', '<=', this.state.dateTo]],
            context: { create: false },
        });
    }

    async onViewAvgConsumptionCycle() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.picking', name: 'Product Consumption Cycle',
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }

    async onViewMonthlyPOStatus() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.order', name: 'Monthly Procurement Status',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [['date_order', '>=', this.state.dateFrom], ['date_order', '<=', this.state.dateTo]],
            context: { create: false, group_by: ['date_order:month', 'state'] },
        });
    }

    async onViewGRNRecords() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.picking', name: 'GRN Records',
            views: [[false, 'list'], [false, 'form'], [false, 'pivot']],
            domain: [['picking_type_code', '=', 'incoming'], ['state', '=', 'done'], ['date_done', '>=', this.state.dateFrom], ['date_done', '<=', this.state.dateTo]],
            context: { create: false, group_by: ['date_done:month'] },
        });
    }

    async onViewPOEvaluation() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'purchase.order', name: 'PO Evaluation',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [['date_order', '>=', this.state.dateFrom], ['date_order', '<=', this.state.dateTo]],
            context: { create: false, group_by: ['date_order:month', 'state'] },
        });
    }

    async onViewDepartmentInventory() {
        if (!this.state.departmentInventory.length) return;
        const departmentIds = this.state.departmentInventory.map(d => d.id).filter(id => id !== 'unmapped');
        this.action.doAction({
            type: 'ir.actions.act_window', name: 'Department-wise Inventory',
            res_model: 'account.analytic.account',
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', departmentIds]],
            context: { create: false },
        });
    }

    async onViewCommoditySpend() {
        const categoryIds = this.state.commoditySpend.map(c => c.categoryId).filter(Boolean);
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'product.template',
            name: 'Products by Category - Spend Analysis',
            views: [[false, 'list'], [false, 'form']],
            domain: categoryIds.length > 0 ? [['categ_id', 'in', categoryIds]] : [['purchase_ok', '=', true]],
            context: { create: false, group_by: ['categ_id'] },
        });
    }

    async onViewConsumptionCycle() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.picking',
            name: 'Product Consumption Cycle',
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }

    async onViewInventoryNotMoved(days) {
        const products = this.state.notMovedDetails
            .filter(p => p.daysNotMoved >= days)
            .map(p => p.productId);
        if (!products.length) return;
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'product.product',
            name: `Inventory Not Consumed (${days}+ days)`,
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', products]],
            context: { create: false },
        });
    }

    async onViewTopPurchasers() {
        if (!this.state.topPurchasers.length) return;
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'res.users', name: 'Top Purchasers',
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', this.state.topPurchasers.map(p => p.id)]],
            context: { create: false },
        });
    }

    async onViewMonthlyInventoryChart() {
        try {
            this.action.doAction({
                type: 'ir.actions.act_window',
                name: 'Monthly Inventory Trend',
                res_model: 'stock.quant',
                views: [
                    [false, 'list'],
                    [false, 'pivot'],
                    [false, 'graph']
                ],
                domain: [
                    ['location_id.usage', '=', 'internal'],
                    ['quantity', '>', 0],
                    ['in_date', '>=', this.state.dateFrom],
                    ['in_date', '<=', this.state.dateTo],
                ],
                context: {
                    create: false,
                    group_by: ['in_date:month'],
                },
            });
        } catch (error) {
            console.error("Error opening Monthly Inventory Trend view:", error);
        }
    }

    async onOpenTargetForm(ev) {
        try {
            const button = ev.currentTarget || ev.target;
            let rawMonth = button.getAttribute('data-month') || button.closest('button')?.getAttribute('data-month');
            if (!rawMonth) { alert('Could not determine month.'); return; }

            const month = this.normalizeMonthKey(rawMonth);
            console.log('Opening target form — raw:', rawMonth, '→ normalized:', month);

            const existingTargets = await this.orm.search('purchase.target', [['month', '=', month]]);
            if (existingTargets?.length > 0) {
                await this.action.doAction({
                    type: 'ir.actions.act_window',
                    res_model: 'purchase.target',
                    res_id: existingTargets[0],
                    views: [[false, 'form']],
                    target: 'new',
                });
            } else {
                await this.action.doAction({
                    type: 'ir.actions.act_window',
                    res_model: 'purchase.target',
                    views: [[false, 'form']],
                    context: { 'default_month': month, 'default_target_value': 0 },
                    target: 'new',
                });
            }
            await this.loadMonthlyTargets();
            this.refreshMonthlyValuesChart();

        } catch (error) {
            console.error('Error opening target form:', error);
            alert('Failed to open target form:\n' + error.message);
        }
    }

    async onViewInventoryTrend() {
        this.action.doAction({
            type: 'ir.actions.act_window', res_model: 'stock.picking', name: 'Monthly GRN Trend',
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [['picking_type_code', '=', 'incoming'], ['state', '=', 'done'], ['date_done', '>=', this.state.dateFrom], ['date_done', '<=', this.state.dateTo]],
            context: { create: false, group_by: ['date_done:month'] },
        });
    }

    async initializeCharts() {
        try {
            if (typeof Chart === 'undefined') {
                await loadJS("https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js");
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.createAllCharts();
        } catch (error) {
            console.error("ERROR initializing charts:", error);
        }
    }

    async createAllCharts() {
        if (typeof Chart === 'undefined') return;
        try {
            this.createTopSuppliersChart();
            this.createTopPurchasersChart();
            this.createMonthlyValuesChartWithTarget();
            this.createMonthlyPOStatusChart();
            this.createMonthlyGRNChart();
            this.createCommodityChart();
            this.createConsumptionChart();
            this.createDepartmentInventoryChart();
            this.createProductionInventoryChart();
        } catch (error) {
            console.error("Error creating charts:", error);
        }
    }

    destroyAllCharts() {
        Object.keys(this.charts).forEach(key => {
            if (this.charts[key]) {
                try { this.charts[key].destroy(); } catch (e) {}
                this.charts[key] = null;
            }
        });
    }

    createTopSuppliersChart() {
        const canvas = document.getElementById('topSuppliersChart');
        if (!canvas || !this.state.topSuppliers.length) return;
        if (this.charts.topSuppliers) { try { this.charts.topSuppliers.destroy(); } catch (e) {} }
        this.charts.topSuppliers = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: this.state.topSuppliers.map(s => s.name),
                datasets: [{ label: 'Total Spend', data: this.state.topSuppliers.map(s => s.totalSpend), backgroundColor: 'rgba(59, 130, 246, 0.8)', borderRadius: 6 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => 'Spend: ' + this.formatCurrency(c.parsed.x) } } },
                scales: { x: { beginAtZero: true, ticks: { callback: (v) => this.formatCurrency(v) } } }
            }
        });
    }

    createProductionInventoryChart() {
        const canvas = document.getElementById('productionInventoryChart');
        if (!canvas) return;

        if (this.charts.productionInventory) {
            try { this.charts.productionInventory.destroy(); } catch(e) {}
            this.charts.productionInventory = null;
        }

        if (!this.state.monthlyProductionInventory || !this.state.monthlyProductionInventory.length) {
            canvas.style.display = 'none';
            const parent = canvas.parentElement;
            const old = parent.querySelector('.no-data-msg');
            if (old) old.remove();
            const msg = document.createElement('div');
            msg.className = 'no-data-msg';
            msg.style.cssText = 'padding:40px;text-align:center;color:#999;font-size:14px;';
            msg.innerHTML = '<i class="fa fa-bar-chart fa-2x" style="display:block;margin-bottom:10px;"></i>No inventory data found for selected date range';
            parent.appendChild(msg);
            return;
        }

        canvas.style.display = 'block';
        const old = canvas.parentElement.querySelector('.no-data-msg');
        if (old) old.remove();

        const data = this.state.monthlyProductionInventory;

        this.charts.productionInventory = new Chart(canvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: data.map(m => m.month),
                datasets: [
                    {
                        label: 'Inventory Value',
                        data: data.map(m => m.inventoryValue),
                        backgroundColor: 'rgba(16, 185, 129, 0.2)',
                        borderColor: 'rgba(16, 185, 129, 1)',
                        borderWidth: 2,
                        fill: true,
                        tension: 0.3,
                        yAxisID: 'y',
                        pointRadius: 4,
                        pointBackgroundColor: 'rgba(16, 185, 129, 1)',
                    }
                ]
            },

            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' },
                    tooltip: {
                        callbacks: {
                            label: (c) => `Inventory Value: ${this.formatCurrency(c.parsed.y)}`
                        }
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true,
                        title: { display: true, text: 'Inventory Value (₹)', color: '#000' },
                        ticks: { callback: (v) => this.formatCurrency(v), color: '#000' }
                    },
                    x: {
                        ticks: { color: '#000' },
                        grid: { display: false }
                    }
                }
            }
        });
    }
    createMonthlyPOStatusChart() {
        const canvas = document.getElementById('monthlyPOStatusChart');
        if (!canvas || !this.state.monthlyPOStatus.length) return;
        if (this.charts.monthlyPOStatus) { try { this.charts.monthlyPOStatus.destroy(); } catch (e) {} }
        this.charts.monthlyPOStatus = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: this.state.monthlyPOStatus.map(m => m.month),
                datasets: [
                    { label: 'Approved', data: this.state.monthlyPOStatus.map(m => m.approved), backgroundColor: 'rgba(16, 185, 129, 0.8)', borderRadius: 6 },
                    { label: 'Pending (RFQ)', data: this.state.monthlyPOStatus.map(m => m.pending), backgroundColor: 'rgba(245, 158, 11, 0.8)', borderRadius: 6 },
                    { label: 'Indent', data: this.state.monthlyPOStatus.map(m => m.indent), backgroundColor: 'rgba(59, 130, 246, 0.8)', borderRadius: 6 },
                ]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top' } },
                scales: { y: { beginAtZero: true, ticks: { precision: 0 } } }
            }
        });
    }

    createMonthlyGRNChart() {
        const canvas = document.getElementById('monthlyGRNChart');
        if (!canvas || !this.state.monthlyGRN.length) return;
        if (this.charts.monthlyGRN) { try { this.charts.monthlyGRN.destroy(); } catch (e) {} }
        this.charts.monthlyGRN = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: this.state.monthlyGRN.map(m => m.month),
                datasets: [{
                    label: 'GRN Count',
                    data: this.state.monthlyGRN.map(m => m.total || 0),
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderColor: 'rgba(16, 185, 129, 1)',
                    borderWidth: 1,
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (c) => 'GRN Count: ' + c.parsed.y,
                            afterLabel: (c) => {
                                const m = this.state.monthlyGRN[c.dataIndex];
                                return 'Total Cost: ' + this.formatCurrency(m.totalCost);
                            }
                        }
                    }
                },
                scales: {
                    x: { ticks: { color: '#000' } },
                    y: { beginAtZero: true, ticks: { precision: 0, color: '#000' }, title: { display: true, text: 'GRN Count', color: '#000' } }
                }
            }
        });
    }

    // Draws a two-line label at the EXACT geometric center of a doughnut's
    _doughnutCenterTextPlugin(id, getLine1, getLine2) {
        return {
            id,
            afterDraw: (chart) => {
                const meta = chart.getDatasetMeta(0);
                const arc = meta && meta.data && meta.data[0];
                if (!arc) return;
                const { ctx } = chart;
                const cx = arc.x;
                const cy = arc.y;
                ctx.save();
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#000';
                ctx.font = "600 11px 'Segoe UI', Arial, sans-serif";
                ctx.fillText(getLine1(), cx, cy - 11);
                ctx.font = "700 15px 'Segoe UI', Arial, sans-serif";
                ctx.fillText(getLine2(), cx, cy + 10);
                ctx.restore();
            }
        };
    }

    createCommodityChart() {
        const canvas = document.getElementById('commodityChart');
        if (!canvas || !this.state.commoditySpend.length) return;
        if (this.charts.commodity) { try { this.charts.commodity.destroy(); } catch (e) {} }
        const top10 = this.state.commoditySpend.slice(0, 10);
        const colors = ['rgba(59,130,246,0.8)', 'rgba(16,185,129,0.8)', 'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.8)', 'rgba(139,92,246,0.8)', 'rgba(236,72,153,0.8)', 'rgba(6,182,212,0.8)', 'rgba(251,146,60,0.8)', 'rgba(34,197,94,0.8)', 'rgba(168,85,247,0.8)'];
        const totalSpend = top10.reduce((sum, c) => sum + c.totalSpend, 0);
        this.charts.commodity = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: top10.map(c => c.category), datasets: [{ data: top10.map(c => c.totalSpend), backgroundColor: colors, borderWidth: 2, borderColor: '#fff' }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${this.formatCurrency(c.parsed)} (${((c.parsed / c.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)` } } }
            },
            plugins: [this._doughnutCenterTextPlugin(
                'commodityCenterText',
                () => 'TOTAL SPEND',
                () => this.formatCurrency(totalSpend)
            )]
        });
    }

    createDepartmentInventoryChart() {
        const canvas = document.getElementById('departmentInventoryChart');
        if (!canvas || !this.state.departmentInventory.length) return;
        if (this.charts.departmentInventory) { try { this.charts.departmentInventory.destroy(); } catch (e) {} }
        const colors = ['rgba(59,130,246,0.8)', 'rgba(16,185,129,0.8)', 'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.8)', 'rgba(139,92,246,0.8)', 'rgba(236,72,153,0.8)', 'rgba(6,182,212,0.8)', 'rgba(251,146,60,0.8)', 'rgba(34,197,94,0.8)', 'rgba(168,85,247,0.8)'];
        const totalCost = this.state.departmentInventory.reduce((sum, d) => sum + d.totalCost, 0);
        this.charts.departmentInventory = new Chart(canvas.getContext('2d'), {
            type: 'doughnut',
            data: { labels: this.state.departmentInventory.map(d => d.name), datasets: [{ data: this.state.departmentInventory.map(d => d.productCount), backgroundColor: colors, borderColor: '#fff', borderWidth: 2 }] },
            options: {
                responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'right' }, tooltip: { callbacks: { label: (c) => `${c.label}: ${c.parsed} products (${((c.parsed / c.dataset.data.reduce((a, b) => a + b, 0)) * 100).toFixed(1)}%)` } } }
            },
            plugins: [this._doughnutCenterTextPlugin(
                'departmentCenterText',
                () => 'TOTAL COST',
                () => this.formatCurrency(totalCost)
            )]
        });
    }

    createConsumptionChart() {
        const canvas = document.getElementById('consumptionChart');
        if (!canvas) return;
        if (!this.state.consumptionByProduct?.length) {
            canvas.parentElement.innerHTML = '<p style="padding: 20px; text-align: center; color: #999;">No consumption data in selected date range</p>';
            return;
        }
        if (this.charts.consumption) { try { this.charts.consumption.destroy(); } catch (e) {} }

        const topProducts = this.state.consumptionByProduct.slice(0, 10);
        const allDepts = new Map();
        topProducts.forEach(prod => {
            Object.values(prod.departments).forEach(dept => {
                if (!allDepts.has(dept.deptId)) allDepts.set(dept.deptId, dept.deptName);
            });
        });

        const colors = ['rgba(59,130,246,0.8)', 'rgba(16,185,129,0.8)', 'rgba(245,158,11,0.8)', 'rgba(239,68,68,0.8)', 'rgba(139,92,246,0.8)', 'rgba(236,72,153,0.8)', 'rgba(6,182,212,0.8)', 'rgba(251,146,60,0.8)', 'rgba(34,197,94,0.8)', 'rgba(168,85,247,0.8)'];
        const datasets = Array.from(allDepts.entries()).map(([deptId, deptName], idx) => ({
            label: deptName,
            data: topProducts.map(p => p.departments[deptId]?.count || 0),
            backgroundColor: colors[idx % colors.length],
            borderWidth: 1,
        }));

        this.charts.consumption = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels: topProducts.map(p => p.productName), datasets },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { position: 'top' }, tooltip: { callbacks: { label: (c) => c.dataset.label + ': ' + c.parsed.x + ' times' } } },
                scales: { x: { stacked: true, beginAtZero: true }, y: { stacked: true } }
            }
        });
    }

    createTopPurchasersChart() {
        const canvas = document.getElementById('topPurchasersChart');
        if (!canvas || !this.state.topPurchasers.length) return;
        if (this.charts.topPurchasers) { try { this.charts.topPurchasers.destroy(); } catch (e) {} }
        this.charts.topPurchasers = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: {
                labels: this.state.topPurchasers.map(p => p.name),
                datasets: [{ label: 'Total Spend', data: this.state.topPurchasers.map(p => p.totalSpend), backgroundColor: 'rgba(139, 92, 246, 0.8)', borderRadius: 6 }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => 'Spend: ' + this.formatCurrency(c.parsed.x) } } },
                scales: { x: { beginAtZero: true, ticks: { callback: (v) => this.formatCurrency(v) } } }
            }
        });
    }
}

registry.category("actions").add("purchase_dashboard", PurchaseDashboard);