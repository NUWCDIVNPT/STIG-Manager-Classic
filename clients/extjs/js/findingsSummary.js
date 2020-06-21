/*
$Id: findingsSummary.js 807 2017-07-27 13:04:19Z csmig $
*/

function addFindingsSummary(collectionId,collectionName) {
	var idAppend = '-findings-summary-' + collectionId;
	var benchmarkId = '';
	
	var findingsGrid = new Ext.grid.GridPanel({
		id: 'findingsGrid-' + collectionId,
		title: 'Findings with Counts',
		region:'center',
		height:50,
		store: new Ext.data.JsonStore ({
			url: 'pl/getFindings.pl',
			sortInfo: {
				field: 'cnt',
				direction: 'DESC'
			},
			root: 'rows',
			totalProperty: 'records',
			sortInfo: {
				field: 'cnt',
				direction: 'DESC' // or 'DESC' (case sensitive for local sorting)
			},
			fields: [
				{name:'cnt',type:'int'},
				{name:'benchmarkIds',type:'string'},
				{name:'groupId',type:'string',sortType: sortGroupId},
				{name:'ruleId',type:'string'},
				{name:'severity',type:'string'},
				{name:'title',type:'string'}
			],
			listeners: {
				load: function (store,records) {
					Ext.getCmp('findingsGrid-' + collectionId + '-totalText').setText(records.length + ' records');
				}
			}
		}),
		columns: [
			{header: "Severity",align:'center',width:10,dataIndex:'severity',sortable:true,renderer:renderSeverity},
			{header: "Group",width:15,dataIndex:'groupId',sortable:true},
			{header: "Rule Title",width:45,dataIndex:'title',renderer:columnWrap,sortable:true,id:'findingsGrid-'+ collectionId + 'title'},
			{header: "# Assets",width:15,align:'right',dataIndex:'cnt',sortable:true},
			{header: "STIGs",width:40,dataIndex:'benchmarkIds',renderer:columnWrap,sortable:true,id:'findingsGrid-'+ collectionId + 'benchmarkIds'}
			//{header: "Rule",width:25,dataIndex:'ruleId',sortable:true},
		],
		autoExpandColumn:'findingsGrid-'+ collectionId + 'benchmarkIds',
		border: false,
		style: {
			borderBottomWidth: "1px"
		},
		loadMask: true,
		stripeRows: true,
		view: new Ext.grid.GridView({
			forceFit:true,
			emptyText: 'No records found.',
			getRowClass: function(record, rowIndex, rp, ds){ // rp = rowParams
				if(record.data.severity == 'high'){
					return 'sm-grid3-row-red';
				} else if (record.data.severity == 'medium') {
					return 'sm-grid3-row-orange';
				} else {
					return 'sm-grid3-row-green';
				}
			}
		}),
		sm: new Ext.grid.RowSelectionModel ({
			singleSelect: true,
			listeners: {
				rowselect: {
					fn: function(sm,index,record) {
						var lo = findingsGrid.getStore().lastOptions;
						hostGrid.getStore().load({
							params:{
								groupId: record.data.groupId, 
								collectionId: collectionId,
								benchmarkId: lo.params.benchmarkId,
								dept: lo.params.dept,
								domain: lo.params.domain,
								status: lo.params.status
							}
						});
						hostGrid.curTitleBase = 'Host details for \'' + record.data.groupId + '\'';
						hostGrid.setTitle(hostGrid.curTitleBase);
					}
				}
			}
		}),
		tbar: new Ext.Toolbar({
			hidden: (curUser.accessLevel !== 3), 
			items: [
			{
				xtype: 'tbtext',
				text: 'STIG:  '
			}
			,{
				xtype: 'combo',
				id: 'combo-stig' + idAppend,
				width: 150,
				allowBlank: true,
				editable: false,
				forceSelection: true,
				name: 'benchmarkId',
				mode: 'remote',
				triggerAction: 'all',
				displayField:'benchmarkId',
				value: '--Any--',
				store: new Ext.data.JsonStore({
					fields: ['benchmarkId'],
					url: 'pl/getStigsForFindings.pl',
					root: 'rows',
					baseParams: {
						collectionId:collectionId
					}
				}),
				listeners: {
					select: function(f,r,i) {
						findingsGrid.getSelectionModel().clearSelections(true);
						hostGrid.getStore().removeAll();
						var lo = findingsGrid.getStore().lastOptions;
						findingsGrid.getStore().load({
							params:{
								context: lo.params.context,
								collectionId: lo.params.collectionId,
								benchmarkId: r.data.benchmarkId,
								domain: lo.params.domain,
								dept: lo.params.dept
							}
						});
					}
				}
			}
			,{
				xtype: 'tbseparator'
			}
			,{
				xtype: 'tbtext',
				text: 'Department:  '
			}
			,{
				xtype: 'combo',
				id: 'combo-dept' + idAppend,
				width: 100,
				allowBlank: true,
				editable: false,
				forceSelection: true,
				name: 'dept',
				mode: 'remote',
				triggerAction: 'all',
				displayField:'dept',
				value: '--Any--',
				store: new Ext.data.JsonStore({
					fields: ['dept'],
					url: 'pl/getAssetAttrForFindings.pl',
					root: 'rows',
					baseParams: {
						workspace: 'report',
						collectionId:collectionId,
						benchmarkId:benchmarkId,
						attribute: 'dept'
					}
				}),
				listeners: {
					select: function(f,r,i) {
						findingsGrid.getSelectionModel().clearSelections(true);
						hostGrid.getStore().removeAll();
						var lo = findingsGrid.getStore().lastOptions;
						findingsGrid.getStore().load({
							params:{
								context: lo.params.context,
								collectionId: lo.params.collectionId,
								benchmarkId: lo.params.benchmarkId,
								domain: lo.params.domain,
								dept: r.data.dept
							}
						});
					}
				}
			}
			,{
				xtype: 'tbseparator'
			}
			,{
				xtype: 'tbtext',
				text: 'Asset Group:  '
			}
			,{
				xtype: 'combo',
				id: 'combo-domain' + idAppend,
				width: 100,
				//emptyText: 'Department...',
				allowBlank: true,
				editable: false,
				forceSelection: true,
				name: 'domain',
				mode: 'remote',
				triggerAction: 'all',
				displayField:'domain',
				value: '--Any--',
				store: new Ext.data.JsonStore({
					fields: ['domain'],
					url: 'pl/getAssetAttrForFindings.pl',
					root: 'rows',
					baseParams: {
						workspace: 'report',
						collectionId:collectionId,
						benchmarkId:benchmarkId,
						attribute: 'domain'
					}
				}),
				listeners: {
					select: function(f,r,i) {
						findingsGrid.getSelectionModel().clearSelections(true);
						hostGrid.getStore().removeAll();
						var lo = findingsGrid.getStore().lastOptions;
						findingsGrid.getStore().load({
							params:{
								context: lo.params.context,
								collectionId: lo.params.collectionId,
								benchmarkId: lo.params.benchmarkId,
								dept: lo.params.dept,
								domain: r.data.domain
							}
						});
					}
				}
			}
			]
		}),
		bbar: new Ext.Toolbar({
			items: [
			{
				xtype: 'tbbutton',
				iconCls: 'icon-refresh',
				tooltip: 'Reload this grid',
				width: 20,
				handler: function(btn){
					findingsGrid.getStore().reload();
				}
			},{
				xtype: 'tbseparator'
			}
			// ,{
				// xtype: 'tbbutton',
				// iconCls: 'icon-excel',
				// tooltip: 'Download an enhanced Audits report spreadsheet',
				// //text: 'Enhanced',
				// width: 20,
				// handler: function(btn){
					// var ourStore = findingsGrid.getStore();
					// var lo = ourStore.lastOptions;
					// window.location=ourStore.url + '?xls=1&collectionId=' + lo.params.collectionId;
				// }
			// }
			,{
				xtype: 'tbbutton',
				iconCls: 'icon-save',
				width: 20,
				tooltip: 'Download this table\'s data as Comma Separated Values (CSV)',
				handler: function(btn){
					var ourStore = findingsGrid.getStore();
					var lo = ourStore.lastOptions;
					window.location=ourStore.url + '?csv=1&collectionId=' + lo.params.collectionId;
				}
			},{
				xtype: 'tbfill'
			},{
				xtype: 'tbseparator'
			},{
				xtype: 'tbtext',
				id: 'findingsGrid-' + collectionId + '-totalText',
				text: '0 records',
				width: 80
			}]
		})
	});

	var expander = new Ext.ux.grid.RowExpander({
		tpl : new Ext.XTemplate(
		)
	});
	
	var hostGrid = new Ext.grid.GridPanel({
		id: 'hostsByFindingGrid-' + collectionId,
		parent: findingsGrid,
		height:300,
		title:'Finding details',
		region:'south',
       // plugins: expander,
		split:true,
		collapsible: true,
		layout:'fit',
		store: new Ext.data.JsonStore({
			url: 'pl/getHostsByFinding.pl',
			root: 'rows',
			sortInfo: {
				field: 'assetName',
				direction: 'ASC' // or 'DESC' (case sensitive for local sorting)
			},
			fields: [
				'assetId',
				'assetName',
				'dept',
				'domain',
				{name:'ruleId',type:'string'},
				//'userName',
				'benchmarkId',
				'ruleId',
				'statusStr',
				{name:'ts',type:'date',dateFormat:'Y-m-d H:i:s'}
			],
			listeners: {
				load: function (store,records) {
					Ext.getCmp('hostsByFindingGrid-' + collectionId + '-totalText').setText(records.length + ' records');
					Ext.getCmp('hostsByFindingGrid-' + collectionId + '-csvBtn').enable();
					Ext.getCmp('hostsByFindingGrid-' + collectionId + '-refreshBtn').enable();
					// if (records.length > 0) {
						// Ext.getCmp(network + '-hostAuditGrid-csvBtn').enable();
						// Ext.getCmp(network + '-hostAuditGrid-refreshBtn').enable();
					// } else {
						// Ext.getCmp(network + '-hostAuditGrid-csvBtn').disable();
						// Ext.getCmp(network + '-hostAuditGrid-refreshBtn').disable();
					// }
					// auditGrid.classification = store.reader.jsonData.classification;
					// auditGrid.setTitle('(' + auditGrid.classification  + ') ' + auditGrid.curTitleBase);
					// setTabTitle();					
				},
				clear: function (store,records) {
					// delete auditGrid.classification;
					// auditGrid.setTitle(auditGrid.emptyTitle);
					// setTabTitle();
				}
			}
		}),
		columns: [
		//	expander,
			{header: "Asset",width:40,dataIndex:'assetName',sortable:true},
			{header: "Dept",width:5,dataIndex:'dept',sortable:true},
			{header: "AssetGroup",width:40,dataIndex:'domain',sortable:true},
			{header: "STIG", width:40, dataIndex: 'benchmarkId', sortable: true},
			{header: "Rule", width: 25, dataIndex: 'ruleId', sortable: true},
			{header: "Status", width:50, dataIndex: 'statusStr', sortable: true},
			{header: "Status changed", width: 50, dataIndex: 'ts', xtype: 'datecolumn',format:'Y-m-d',sortable: true}
		],
		view: new Ext.grid.GridView({
			forceFit:true,
			emptyText: 'Please select a row in the table above.',
			deferEmptyText:false
		}),
		border: false,
		style: {
			borderTopWidth: "1px"
		},
		loadMask: true,
		stripeRows: true,
		bbar: new Ext.Toolbar({
			items: [
			{
				xtype: 'tbbutton',
				id: 'hostsByFindingGrid-' + collectionId + '-refreshBtn',
				iconCls: 'icon-refresh',
				tooltip: 'Reload this grid',
				disabled:true,
				width: 20,
				handler: function(btn){
					hostGrid.getStore().reload();
				}
			},{
				xtype: 'tbseparator'
			},			{
				xtype: 'tbbutton',
				id: 'hostsByFindingGrid-' + collectionId + '-csvBtn',
				iconCls: 'icon-save',
				tooltip: 'Download this table\'s data as Comma Separated Values (CSV)',
				disabled:true,
				width: 20,
				handler: function(btn){
					var ourStore = hostGrid.getStore();
					var lo = ourStore.lastOptions;
					// window.location=ourStore.url + '?csv=1&db=' + lo.params.db + '&type=' + lo.params.type + '&ip=' + lo.params.ip;
					window.location=ourStore.url + '?csv=1&collectionId=' + lo.params.collectionId + '&ruleId=' + lo.params.ruleId;					
				}
			},{
				xtype: 'tbfill'
			},{
				xtype: 'tbseparator'
			},{
				xtype: 'tbtext',
				id: 'hostsByFindingGrid-' + collectionId + '-totalText',
				text: '0 records',
				width: 80
			}]
		}),
		sm: new Ext.grid.RowSelectionModel ({
			singleSelect: true
		}),
		listeners: {
			rowdblclick: {
				fn: function(grid,rowIndex,e) {
					Ext.getCmp('main-tabs').setActiveTab('tab-reviews');
					var r = grid.getStore().getAt(rowIndex);
					fakeLeaf = new Object();
					fakeLeaf.assetId = r.get('assetId');
					fakeLeaf.assetName = r.get('assetName');
					fakeLeaf.benchmarkId = r.get('benchmarkId');
					fakeLeaf.stigName = r.get('benchmarkId');
					fakeLeaf.revId = r.get('revId');
					addReview(fakeLeaf,r.get('ruleId'));
					
					//Ext.getCmp('groupGrid').getStore().load({params:{assetId:assetId, revId:revId}});
				}
			}
		}
	});

	var thisTab = Ext.getCmp('reports-center-tab').add({
		id: 'findingsTab-' + collectionId,
		iconCls: 'sm-report-icon',
		title: 'Findings Summary (' + collectionName + ')',
		closable:true,
		layout: 'border',
		items: [findingsGrid,hostGrid]
	});
	thisTab.show();
	
	findingsGrid.getStore().load({params:{collectionId: collectionId}});

}; //end addCompletionReport();

// function renderSeverity(value, metaData, record, rowIndex, colIndex, store) {
// 	if (value == 'high') {
// 		return 'Cat 1';
// 	} else if (value == 'medium') {
// 		return 'Cat 2';
// 	} else if (value == 'low') {
// 		return 'Cat 3';
// 	} 
// }