/** @odoo-module **/

import { registry } from "@web/core/registry";
import { Component, onWillStart, onMounted, useState } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { loadJS } from "@web/core/assets";

export class MasterComparisonDashboard extends Component {
    static template = "master_comparison_dashboard.MasterDashboard";

    setup() {
        this.orm = useService("orm");
        this.action = useService("action");

        this.state = useState({
            companyA: {
                id: null,
                name: 'Company A',
                totalSpend: 0,
                inventoryCost: 0,
                itemsCount: 0,
                grnCount: 0,
                avgIndentToPO: 0,
                avgPOToReceipt: 0,
                newVendorsCount: 0,
                avgConsumptionCycle: 0,
                monthlyProcurement: [],
                monthlyGRN: [],
                monthlyPORelease: [],
                monthlyPOEvaluation: [],
                departmentInventory: [],
                commoditySpend: [],
                topSuppliers: [],
            },
            companyB: {
                id: null,
                name: 'Company B',
                totalSpend: 0,
                inventoryCost: 0,
                itemsCount: 0,
                grnCount: 0,
                avgIndentToPO: 0,
                avgPOToReceipt: 0,
                newVendorsCount: 0,
                avgConsumptionCycle: 0,
                monthlyProcurement: [],
                monthlyGRN: [],
                monthlyPORelease: [],
                monthlyPOEvaluation: [],
                departmentInventory: [],
                commoditySpend: [],
                topSuppliers: [],
            },
            dateFrom: this.getYearStart(),
            dateTo: this.getCurrentDate(),
            isLoading: false,
        });

        this.charts = {
            companyA: {
                procurement: null,
                grn: null,
                poRelease: null,
                poEvaluation: null,
                department: null,
                commodity: null,
                suppliers: null,
                consumption: null,
            },
            companyB: {
                procurement: null,
                grn: null,
                poRelease: null,
                poEvaluation: null,
                department: null,
                commodity: null,
                suppliers: null,
                consumption: null,
            },
        };

        onWillStart(async () => {
            await this.loadCompanies();
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

    async loadCompanies() {
        try {
            const companies = await this.orm.searchRead(
                "res.company",
                [],
                ['id', 'name'],
                { limit: 2 }
            );

            if (companies.length >= 1) {
                this.state.companyA.id = companies[0].id;
                this.state.companyA.name = companies[0].name;
            }
            if (companies.length >= 2) {
                this.state.companyB.id = companies[1].id;
                this.state.companyB.name = companies[1].name;
            }
        } catch (error) {
            console.error("Error loading companies:", error);
        }
    }

    async loadDashboardData() {
        this.state.isLoading = true;
        try {
            await Promise.all([
                this.loadCompanyData('companyA', this.state.companyA.id),
                this.loadCompanyData('companyB', this.state.companyB.id),
            ]);
        } catch (error) {
            console.error("Error loading dashboard data:", error);
        } finally {
            this.state.isLoading = false;
        }
    }

    async loadCompanyData(companyKey, companyId) {
        if (!companyId) return;

        try {
            await Promise.all([
                this.loadFinancialMetrics(companyKey, companyId),
                this.loadSupplierData(companyKey, companyId),
                this.loadPOMetrics(companyKey, companyId),
                this.loadInventoryMetrics(companyKey, companyId),
                this.loadConsumptionMetrics(companyKey, companyId),
                this.loadCommodityData(companyKey, companyId),
                this.loadGRNMetrics(companyKey, companyId),
                this.loadTimingMetrics(companyKey, companyId),
                this.loadDepartmentInventory(companyKey, companyId),
            ]);
        } catch (error) {
            console.error(`Error loading data for ${companyKey}:`, error);
        }
    }

    async loadFinancialMetrics(companyKey, companyId) {
        try {
            const pos = await this.orm.searchRead(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['company_id', '=', companyId],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                ],
                ['amount_total']
            );

            this.state[companyKey].totalSpend = pos.reduce((sum, po) => sum + (po.amount_total || 0), 0);

            const quants = await this.orm.searchRead(
                "stock.quant",
                [
                    ['company_id', '=', companyId],
                    ['quantity', '>', 0],
                    ['location_id.usage', '=', 'internal'],
                ],
                ['value']
            );

            this.state[companyKey].inventoryCost = quants.reduce((sum, q) => sum + (q.value || 0), 0);
        } catch (error) {
            console.error(`Error loading financial metrics for ${companyKey}:`, error);
        }
    }

    async loadSupplierData(companyKey, companyId) {
        try {
            const topSuppliersData = await this.orm.readGroup(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['company_id', '=', companyId],
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                ],
                ['partner_id', 'amount_total:sum'],
                ['partner_id'],
                { limit: 5, orderby: 'amount_total desc' }
            );

            this.state[companyKey].topSuppliers = topSuppliersData.map(item => ({
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
                    ['company_id', '=', companyId],
                ]
            );
            this.state[companyKey].newVendorsCount = newVendors;
        } catch (error) {
            console.error(`Error loading supplier data for ${companyKey}:`, error);
        }
    }

    async loadPOMetrics(companyKey, companyId) {
        try {
            const productCount = await this.orm.searchCount(
                "product.template",
                [['active', '=', true]]
            );
            this.state[companyKey].itemsCount = productCount;

            // Load monthly PO status with indents
            await this.loadMonthlyPOStatus(companyKey, companyId);

            const monthlyRelease = await this.orm.readGroup(
                "purchase.order",
                [
                    ['company_id', '=', companyId],
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            this.state[companyKey].monthlyPORelease = this.processMonthlyPORelease(monthlyRelease);

            const monthlyEvaluation = await this.orm.readGroup(
                "purchase.order",
                [
                    ['company_id', '=', companyId],
                    ['date_order', '>=', this.state.dateFrom],
                    ['date_order', '<=', this.state.dateTo],
                ],
                ['amount_total:sum'],
                ['date_order:month', 'state'],
                { lazy: false }
            );

            this.state[companyKey].monthlyPOEvaluation = this.processMonthlyPOEvaluation(monthlyEvaluation);
        } catch (error) {
            console.error(`Error loading PO metrics for ${companyKey}:`, error);
        }
    }

    async loadMonthlyPOStatus(companyKey, companyId) {
        try {
            // Get monthly approved POs
            const approvedPOs = await this.orm.readGroup(
                "purchase.order",
                [
                    ['date_approve', '>=', this.state.dateFrom],
                    ['date_approve', '<=', this.state.dateTo],
                    ['state', 'in', ['purchase', 'done']],
                    ['company_id', '=', companyId],
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
                    ['company_id', '=', companyId],
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
                    ['company_id', '=', companyId],
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

            this.state[companyKey].monthlyProcurement = Object.values(monthlyStatus)
                .sort((a, b) => a.month.localeCompare(b.month));

            console.log("Monthly PO status loaded for", companyKey);
        } catch (error) {
            console.error(`Error loading monthly PO status for ${companyKey}:`, error);
            this.state[companyKey].monthlyProcurement = [];
        }
    }

    async loadGRNMetrics(companyKey, companyId) {
        try {
            const currentMonthGRN = await this.orm.searchCount(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', '=', 'done'],
                    ['company_id', '=', companyId],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ]
            );

            this.state[companyKey].grnCount = currentMonthGRN;

            const monthlyGRNData = await this.orm.readGroup(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'incoming'],
                    ['state', '=', 'done'],
                    ['company_id', '=', companyId],
                    ['date_done', '>=', this.state.dateFrom],
                    ['date_done', '<=', this.state.dateTo],
                ],
                ['__count'],
                ['date_done:month'],
                { lazy: false }
            );

            this.state[companyKey].monthlyGRN = monthlyGRNData.map(item => ({
                month: item['date_done:month'],
                count: item.__count || 0,
            })).sort((a, b) => a.month.localeCompare(b.month));
        } catch (error) {
            console.error(`Error loading GRN metrics for ${companyKey}:`, error);
        }
    }

    async loadTimingMetrics(companyKey, companyId) {
        try {
            let totalIndentToPODays = 0;
            let indentToPOCount = 0;

            const poLines = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['purchase_request_lines', '!=', false],
                    ['company_id', '=', companyId],
                ],
                ['id', 'order_id', 'purchase_request_lines'],
                { limit: 1000 }
            );

            if (poLines.length > 0) {
                const poIds = [...new Set(poLines.map(line => line.order_id[0]))];
                const pos = await this.orm.searchRead(
                    "purchase.order",
                    [['id', 'in', poIds]],
                    ['id', 'date_order', 'date_approve']
                );

                const poMap = {};
                pos.forEach(po => {
                    poMap[po.id] = po;
                });

                const allRequestLineIds = [];
                poLines.forEach(line => {
                    if (line.purchase_request_lines) {
                        allRequestLineIds.push(...line.purchase_request_lines);
                    }
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
                        ['id', 'date_start']
                    );

                    const requestMap = {};
                    requests.forEach(req => {
                        requestMap[req.id] = req;
                    });

                    const requestLineToRequest = {};
                    requestLines.forEach(rl => {
                        requestLineToRequest[rl.id] = rl.request_id[0];
                    });

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

            this.state[companyKey].avgIndentToPO = indentToPOCount > 0
                ? (totalIndentToPODays / indentToPOCount).toFixed(2)
                : 0;

            const purchaseOrders = await this.orm.searchRead(
                "purchase.order",
                [
                    ['state', 'in', ['purchase', 'done']],
                    ['company_id', '=', companyId],
                    ['picking_ids', '!=', false],
                ],
                ['id', 'date_approve', 'date_order', 'picking_ids'],
                { limit: 1000 }
            );

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
                            ['id', 'date_done']
                        );

                        if (pickings.length > 0 && pickings[0].date_done) {
                            const poDate = new Date(po.date_approve || po.date_order);
                            const receiptDate = new Date(pickings[0].date_done);
                            const days = Math.floor((receiptDate - poDate) / (1000 * 60 * 60 * 24));

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

            this.state[companyKey].avgPOToReceipt = poToReceiptCount > 0
                ? (totalPOToReceiptDays / poToReceiptCount).toFixed(2)
                : 0;
        } catch (error) {
            console.error(`Error loading timing metrics for ${companyKey}:`, error);
        }
    }

    async loadInventoryMetrics(companyKey, companyId) {
        // Placeholder - implement if needed
    }

    async loadConsumptionMetrics(companyKey, companyId) {
        try {
            const poLines = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.company_id', '=', companyId],
                    ['order_id.date_order', '>=', this.state.dateFrom],
                    ['order_id.date_order', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                ],
                ['product_id', 'date_planned', 'order_id']
            );

            if (poLines.length === 0) {
                this.state[companyKey].avgConsumptionCycle = 0;
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

            let totalDays = 0;
            let totalCount = 0;

            for (const line of poLines) {
                const plannedDate = line.date_planned;
                const orderDate = poDateMap[line.order_id[0]];

                if (plannedDate && orderDate) {
                    const planned = new Date(plannedDate);
                    const ordered = new Date(orderDate);
                    const days = Math.floor((planned - ordered) / (1000 * 60 * 60 * 24));

                    if (days > 0 && days < 365) {
                        totalDays += days;
                        totalCount++;
                    }
                }
            }

            this.state[companyKey].avgConsumptionCycle = totalCount > 0
                ? (totalDays / totalCount).toFixed(2)
                : 0;
        } catch (error) {
            console.error(`Error loading consumption metrics for ${companyKey}:`, error);
        }
    }

    async loadCommodityData(companyKey, companyId) {
        try {
            const categoryData = await this.orm.searchRead(
                "purchase.order.line",
                [
                    ['order_id.state', 'in', ['purchase', 'done']],
                    ['order_id.company_id', '=', companyId],
                    ['order_id.date_approve', '>=', this.state.dateFrom],
                    ['order_id.date_approve', '<=', this.state.dateTo],
                    ['product_id', '!=', false],
                ],
                ['price_subtotal', 'product_id'],
                { limit: 1000 }
            );

            const categorizedData = {};

            for (const item of categoryData.slice(0, 100)) {
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

            this.state[companyKey].commoditySpend = Object.values(categorizedData)
                .sort((a, b) => b.totalSpend - a.totalSpend);
        } catch (error) {
            console.error(`Error loading commodity data for ${companyKey}:`, error);
        }
    }

    async loadDepartmentInventory(companyKey, companyId) {
        try {
            const pickings = await this.orm.searchRead(
                "stock.picking",
                [
                    ['picking_type_code', '=', 'internal'],
                    ['state', '=', 'done'],
                    ['company_id', '=', companyId],
                    ['issue_department_id', '!=', false],
                ],
                ['id', 'issue_department_id', 'move_ids_without_package'],
                { limit: 1000 }
            );

            if (pickings.length === 0) {
                this.state[companyKey].departmentInventory = [];
                return;
            }

            const allMoveIds = [];
            pickings.forEach(picking => {
                if (picking.move_ids_without_package && picking.move_ids_without_package.length > 0) {
                    allMoveIds.push(...picking.move_ids_without_package);
                }
            });

            const moves = await this.orm.searchRead(
                "stock.move",
                [
                    ['id', 'in', allMoveIds],
                    ['state', '=', 'done'],
                ],
                ['product_id', 'picking_id', 'product_uom_qty'],
                { limit: 5000 }
            );

            const pickingDeptMap = {};
            pickings.forEach(p => {
                pickingDeptMap[p.id] = {
                    deptId: p.issue_department_id[0],
                    deptName: p.issue_department_id[1],
                };
            });

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
                        totalQty: 0,
                        products: new Set(),
                    };
                }

                deptData[deptId].products.add(move.product_id[0]);
                deptData[deptId].totalQty += move.product_uom_qty || 0;
            });

            this.state[companyKey].departmentInventory = Object.values(deptData)
                .map(d => ({
                    ...d,
                    productCount: d.products.size,
                }))
                .sort((a, b) => b.totalQty - a.totalQty);
        } catch (error) {
            console.error(`Error loading department inventory for ${companyKey}:`, error);
        }
    }

    processMonthlyProcurement(data) {
        const monthly = {};

        data.forEach(item => {
            const month = item['date_order:month'];
            if (!month) return;

            if (!monthly[month]) {
                monthly[month] = { month, approved: 0, pending: 0, indent: 0 };
            }

            const count = item.__count || 0;
            if (['purchase', 'done'].includes(item.state)) {
                monthly[month].approved += count;
            } else if (['draft', 'sent', 'to approve'].includes(item.state)) {
                monthly[month].pending += count;
            } else {
                // All other states count as indent (including 'cancel', etc.)
                monthly[month].indent += count;
            }
        });

        return Object.values(monthly).sort((a, b) => a.month.localeCompare(b.month));
    }

    processMonthlyPORelease(data) {
        const monthly = {};

        data.forEach(item => {
            const month = item['date_order:month'];
            if (!month) return;

            if (!monthly[month]) {
                monthly[month] = { month, planned: 0, released: 0 };
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

    processMonthlyPOEvaluation(data) {
        const monthly = {};

        data.forEach(item => {
            const month = item['date_order:month'];
            if (!month) return;

            if (!monthly[month]) {
                monthly[month] = { month, plannedValue: 0, actualValue: 0 };
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
        if (value >= 10000000) {
            return '₹' + (value / 10000000).toFixed(2) + ' Cr';
        } else if (value >= 100000) {
            return '₹' + (value / 100000).toFixed(2) + ' L';
        } else if (value >= 1000) {
            return '₹' + (value / 1000).toFixed(2) + ' K';
        } else {
            return '₹' + value.toFixed(2);
        }
    }

    formatNumber(value) {
        return new Intl.NumberFormat('en-IN').format(value || 0);
    }

    async onRefreshDashboard() {
        this.destroyAllCharts();
        await this.loadDashboardData();
        await new Promise(resolve => setTimeout(resolve, 300));
        await this.createAllCharts();
    }

    async onDownloadDashboard(ev) {
        let buttonElement = null;

        try {
            // Get button element
            buttonElement = ev.target.closest('button');

            // Load html2canvas library if not already loaded
            if (typeof html2canvas === 'undefined') {
                await loadJS("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js");
            }

            // Show loading indicator
            const originalHTML = buttonElement.innerHTML;
            buttonElement.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Generating...';
            buttonElement.disabled = true;

            // Wait a moment for the UI to update
            await new Promise(resolve => setTimeout(resolve, 300));

            // Get the dashboard content element - CORRECTED SELECTOR
            const dashboardElement = document.querySelector('.o_master_comparison_dashboard');

            if (!dashboardElement) {
                console.error('Dashboard element not found');
                throw new Error('Dashboard element not found');
            }

            console.log('Dashboard element found:', dashboardElement);

            // Generate canvas from the dashboard
            const canvas = await html2canvas(dashboardElement, {
                backgroundColor: '#f8f9fa',
                scale: 1.5, // Reduced from 2 for better performance
                logging: true, // Enable logging for debugging
                useCORS: true,
                allowTaint: true,
                scrollY: -window.scrollY,
                scrollX: -window.scrollX,
                width: dashboardElement.scrollWidth,
                height: dashboardElement.scrollHeight,
            });

            console.log('Canvas generated:', canvas);

            // Convert canvas to blob
            canvas.toBlob((blob) => {
                if (!blob) {
                    throw new Error('Failed to create blob from canvas');
                }

                // Create download link
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');

                // Generate filename with current date
                const dateStr = new Date().toISOString().split('T')[0];
                link.download = `Comparison_Dashboard_${dateStr}.png`;
                link.href = url;

                // Trigger download
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);

                // Clean up
                setTimeout(() => URL.revokeObjectURL(url), 100);

                // Restore button
                if (buttonElement) {
                    buttonElement.innerHTML = originalHTML;
                    buttonElement.disabled = false;
                }
            }, 'image/png');

        } catch (error) {
            console.error('Error downloading dashboard:', error);
            alert('Failed to download dashboard. Error: ' + error.message);

            // Restore button on error
            if (buttonElement) {
                buttonElement.innerHTML = '<i class="fa fa-download"></i> Download';
                buttonElement.disabled = false;
            }
        }
    }

    async onDateFilterChange(ev) {
        const field = ev.target.name;
        this.state[field] = ev.target.value;
        await this.onRefreshDashboard();
    }

    async initializeCharts() {
        try {
            if (typeof Chart === 'undefined') {
                await loadJS("https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js");
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.createAllCharts();
        } catch (error) {
            console.error("Error initializing charts:", error);
        }
    }

    async createAllCharts() {
        if (typeof Chart === 'undefined') return;

        try {
            // Company A Charts
            this.createProcurementChart('companyA', 'procurementChartA');
            this.createGRNChart('companyA', 'grnChartA');
            this.createPOReleaseChart('companyA', 'poReleaseChartA');
            this.createPOEvaluationChart('companyA', 'poEvaluationChartA');
            this.createDepartmentChart('companyA', 'departmentChartA');
            this.createCommodityChart('companyA', 'commodityChartA');
            this.createSuppliersChart('companyA', 'suppliersChartA');
            this.createConsumptionChart('companyA', 'consumptionChartA');

            // Company B Charts
            this.createProcurementChart('companyB', 'procurementChartB');
            this.createGRNChart('companyB', 'grnChartB');
            this.createPOReleaseChart('companyB', 'poReleaseChartB');
            this.createPOEvaluationChart('companyB', 'poEvaluationChartB');
            this.createDepartmentChart('companyB', 'departmentChartB');
            this.createCommodityChart('companyB', 'commodityChartB');
            this.createSuppliersChart('companyB', 'suppliersChartB');
            this.createConsumptionChart('companyB', 'consumptionChartB');
        } catch (error) {
            console.error("Error creating charts:", error);
        }
    }

    destroyAllCharts() {
        Object.keys(this.charts).forEach(company => {
            Object.keys(this.charts[company]).forEach(chartType => {
                if (this.charts[company][chartType]) {
                    try {
                        this.charts[company][chartType].destroy();
                        this.charts[company][chartType] = null;
                    } catch (e) {
                        console.error(`Error destroying chart:`, e);
                    }
                }
            });
        });
    }

    createProcurementChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].monthlyProcurement.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].procurement) {
            this.charts[companyKey].procurement.destroy();
        }

        const data = this.state[companyKey].monthlyProcurement;

        this.charts[companyKey].procurement = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(m => m.month),
                datasets: [
                    {
                        label: 'Approved',
                        data: data.map(m => m.approved),
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderRadius: 6,
                    },
                    {
                        label: 'Pending',
                        data: data.map(m => m.pending),
                        backgroundColor: 'rgba(245, 158, 11, 0.8)',
                        borderRadius: 6,
                    },
                    {
                        label: 'Indent',
                        data: data.map(m => m.indent),
                        backgroundColor: 'rgba(59, 130, 246, 0.8)',
                        borderRadius: 6,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'top' }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    createGRNChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].monthlyGRN.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].grn) {
            this.charts[companyKey].grn.destroy();
        }

        const data = this.state[companyKey].monthlyGRN;

        this.charts[companyKey].grn = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(m => m.month),
                datasets: [{
                    label: 'GRN Count',
                    data: data.map(m => m.count),
                    borderColor: companyKey === 'companyA' ? 'rgba(59, 130, 246, 1)' : 'rgba(16, 185, 129, 1)',
                    backgroundColor: companyKey === 'companyA' ? 'rgba(59, 130, 246, 0.1)' : 'rgba(16, 185, 129, 0.1)',
                    borderWidth: 3,
                    tension: 0.4,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    createPOReleaseChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].monthlyPORelease.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].poRelease) {
            this.charts[companyKey].poRelease.destroy();
        }

        const data = this.state[companyKey].monthlyPORelease;

        this.charts[companyKey].poRelease = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.map(m => m.month),
                datasets: [
                    {
                        label: 'Planned',
                        data: data.map(m => m.planned),
                        borderColor: 'rgba(245, 158, 11, 1)',
                        backgroundColor: 'rgba(245, 158, 11, 0.1)',
                        borderWidth: 3,
                        tension: 0.4,
                        fill: true,
                    },
                    {
                        label: 'Released',
                        data: data.map(m => m.released),
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
                    legend: { position: 'top' }
                },
                scales: {
                    y: { beginAtZero: true, ticks: { precision: 0 } }
                }
            }
        });
    }

    createPOEvaluationChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].monthlyPOEvaluation.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].poEvaluation) {
            this.charts[companyKey].poEvaluation.destroy();
        }

        const data = this.state[companyKey].monthlyPOEvaluation;

        this.charts[companyKey].poEvaluation = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(m => m.month),
                datasets: [
                    {
                        label: 'Planned Value',
                        data: data.map(m => m.plannedValue),
                        backgroundColor: 'rgba(245, 158, 11, 0.8)',
                        borderRadius: 6,
                    },
                    {
                        label: 'Actual Value',
                        data: data.map(m => m.actualValue),
                        backgroundColor: 'rgba(16, 185, 129, 0.8)',
                        borderRadius: 6,
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
    }

    createDepartmentChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].departmentInventory.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].department) {
            this.charts[companyKey].department.destroy();
        }

        const data = this.state[companyKey].departmentInventory;

        this.charts[companyKey].department = new Chart(ctx, {
            type: 'pie',
            data: {
                labels: data.map(d => d.name),
                datasets: [{
                    data: data.map(d => d.productCount),
                    backgroundColor: [
                        'rgba(59, 130, 246, 0.8)',
                        'rgba(16, 185, 129, 0.8)',
                        'rgba(245, 158, 11, 0.8)',
                        'rgba(239, 68, 68, 0.8)',
                        'rgba(139, 92, 246, 0.8)',
                        'rgba(236, 72, 153, 0.8)',
                        'rgba(6, 182, 212, 0.8)',
                        'rgba(251, 146, 60, 0.8)',
                    ],
                    borderWidth: 2,
                    borderColor: '#fff',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' }
                }
            }
        });
    }

    createCommodityChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].commoditySpend.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].commodity) {
            this.charts[companyKey].commodity.destroy();
        }

        const topCategories = this.state[companyKey].commoditySpend.slice(0, 8);

        this.charts[companyKey].commodity = new Chart(ctx, {
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
                    ],
                    borderWidth: 2,
                    borderColor: '#fff',
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { position: 'right' },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return context.label + ': ' + this.formatCurrency(context.parsed);
                            }
                        }
                    }
                }
            }
        });
    }

    createSuppliersChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas || this.state[companyKey].topSuppliers.length === 0) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].suppliers) {
            this.charts[companyKey].suppliers.destroy();
        }

        const data = this.state[companyKey].topSuppliers;

        this.charts[companyKey].suppliers = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(s => s.name),
                datasets: [{
                    label: 'Total Spend',
                    data: data.map(s => s.totalSpend),
                    backgroundColor: 'rgba(59, 130, 246, 0.8)',
                    borderRadius: 6,
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                return 'Spend: ' + this.formatCurrency(context.parsed.x);
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
                    }
                }
            }
        });
    }

    createConsumptionChart(companyKey, canvasId) {
        const canvas = document.getElementById(canvasId);
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (this.charts[companyKey].consumption) {
            this.charts[companyKey].consumption.destroy();
        }

        // Placeholder chart - will show average consumption cycle
        this.charts[companyKey].consumption = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: ['Avg Consumption Cycle'],
                datasets: [{
                    label: 'Days',
                    data: [parseFloat(this.state[companyKey].avgConsumptionCycle) || 0],
                    backgroundColor: 'rgba(16, 185, 129, 0.8)',
                    borderRadius: 6,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false }
                },
                scales: {
                    y: { beginAtZero: true }
                }
            }
        });
    }

    // KPI Click Handlers
    async onViewTotalPOs(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: `Purchase Orders - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['purchase', 'done']],
                ['company_id', '=', companyId],
                ['date_approve', '>=', this.state.dateFrom],
                ['date_approve', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewTotalInventory(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.quant',
            name: `Inventory - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['quantity', '>', 0],
                ['location_id.usage', '=', 'internal'],
                ['company_id', '=', companyId],
            ],
            context: { create: false },
        });
    }

    async onViewItemsWithPO(companyKey) {
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.product',
            name: `Products - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }

    async onViewGRNCleared(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: `GRN Cleared - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['picking_type_code', '=', 'incoming'],
                ['state', '=', 'done'],
                ['company_id', '=', companyId],
                ['date_done', '>=', this.state.dateFrom],
                ['date_done', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewAvgIndentToPO(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.request',
            name: `Purchase Requests - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['date_start', '>=', this.state.dateFrom],
                ['date_start', '<=', this.state.dateTo],
                ['company_id', '=', companyId],
            ],
            context: { create: false },
        });
    }

    async onViewAvgPOToReceipt(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: `PO to Receipt - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['state', 'in', ['purchase', 'done']],
                ['company_id', '=', companyId],
                ['date_approve', '>=', this.state.dateFrom],
                ['date_approve', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    async onViewNewVendors(companyKey) {
        const companyId = this.state[companyKey].id;
        const monthStart = new Date();
        monthStart.setDate(1);
        const monthStartStr = monthStart.toISOString().split('T')[0];

        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'res.partner',
            name: `New Vendors - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['supplier_rank', '>', 0],
                ['create_date', '>=', monthStartStr],
                ['company_id', '=', companyId],
            ],
            context: { create: false },
        });
    }

    async onViewAvgConsumptionCycle(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order.line',
            name: `Consumption Cycle - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [
                ['order_id.state', 'in', ['purchase', 'done']],
                ['order_id.company_id', '=', companyId],
                ['order_id.date_order', '>=', this.state.dateFrom],
                ['order_id.date_order', '<=', this.state.dateTo],
            ],
            context: { create: false },
        });
    }

    // Chart View All Handlers
    async onViewMonthlyPOStatus(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: `Monthly PO Status - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
                ['company_id', '=', companyId],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewGRNRecords(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: `GRN Records - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form'], [false, 'pivot']],
            domain: [
                ['picking_type_code', '=', 'incoming'],
                ['state', '=', 'done'],
                ['company_id', '=', companyId],
                ['date_done', '>=', this.state.dateFrom],
                ['date_done', '<=', this.state.dateTo],
            ],
            context: {
                create: false,
                group_by: ['date_done:month'],
            },
        });
    }

    async onViewPORelease(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: `PO Release - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
                ['company_id', '=', companyId],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewPOEvaluation(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'purchase.order',
            name: `PO Evaluation - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'pivot'], [false, 'graph']],
            domain: [
                ['date_order', '>=', this.state.dateFrom],
                ['date_order', '<=', this.state.dateTo],
                ['company_id', '=', companyId],
            ],
            context: {
                create: false,
                group_by: ['date_order:month', 'state'],
            },
        });
    }

    async onViewDepartmentInventory(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'stock.picking',
            name: `Department Inventory - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form'], [false, 'pivot']],
            domain: [
                ['picking_type_code', '=', 'internal'],
                ['state', '=', 'done'],
                ['company_id', '=', companyId],
                ['issue_department_id', '!=', false],
            ],
            context: {
                create: false,
                group_by: ['issue_department_id'],
            },
        });
    }

    async onViewCommoditySpend(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.template',
            name: `Commodity Spend - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [['purchase_ok', '=', true]],
            context: {
                create: false,
                group_by: ['categ_id'],
            },
        });
    }

    async onViewTopSuppliers(companyKey) {
        if (this.state[companyKey].topSuppliers.length === 0) return;

        const supplierIds = this.state[companyKey].topSuppliers.map(s => s.id);
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'res.partner',
            name: `Top Suppliers - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            domain: [['id', 'in', supplierIds]],
            context: { create: false },
        });
    }

    async onViewConsumptionCycle(companyKey) {
        const companyId = this.state[companyKey].id;
        this.action.doAction({
            type: 'ir.actions.act_window',
            res_model: 'product.product',
            name: `Consumption Cycle - ${this.state[companyKey].name}`,
            views: [[false, 'list'], [false, 'form']],
            context: { create: false },
        });
    }
}

registry.category("actions").add("master_purchase_dashboard", MasterComparisonDashboard);