Ext.ns('SM.User')

SM.User.GroupSpriteHtml = `<span class="sm-label-sprite {extraCls}" style="color:black;background-color:#888;">{[SM.he(values)]}</span>`

SM.User.GroupTpl = new Ext.XTemplate(
  SM.User.GroupSpriteHtml
)
SM.User.GroupArrayTpl = new Ext.XTemplate(
  '<tpl for=".">',
  `${SM.User.GroupSpriteHtml} `,
  '</tpl>'
)

SM.User.EffectiveGrantsGrid = Ext.extend(Ext.grid.GridPanel, {
  initComponent: function () {
    const fields = [
      {
        name: 'collectionId',
        mapping: 'collection.collectionId'
      },
      {
        name: 'name',
        mapping: 'collection.name'
      },
      'roleId',
      'grantees'
    ]
    const totalTextCmp = new Ext.Toolbar.TextItem({
      text: '0 records',
      width: 80
    })
    const store = new Ext.data.JsonStore({
      grid: this,
      root: '',
      fields,
      idProperty: 'collectionId',
      sortInfo: {
        field: 'name',
        direction: 'ASC' // or 'DESC' (case sensitive for local sorting)
      },
      listeners: {
        load: function (store, records) {
          totalTextCmp.setText(records.length + ' records');
        }
      }
    })
    const columns = [
      {
        header: "Collection",
        width: 150,
        dataIndex: 'name',
        sortable: true,
      },
      {
        header: '<span exportvalue="Grantee">Grantee<i class= "fa fa-question-circle sm-question-circle"></i></span>',
        width: 150,
        dataIndex: 'grantees',
        sortable: false,
        renderer: function (grantees) {
          const divs = []
          for (const source of grantees) {
            const icon = source.userId ? 'sm-user-icon' : 'sm-users-icon'
            const title = source.userId ? 'Direct' : source.name
            divs.push(`<div class="x-combo-list-item ${icon} sm-combo-list-icon" exportValue="${title}">
                    <span style="font-weight:600;">${title}</span></div>`)
          }
          return divs.join('')
        }
      },
      {
        header: "Role",
        width: 100,
        dataIndex: 'roleId',
        sortable: true,
        renderer: (v) => SM.RoleStrings[v],
      }
    ]
    const bbar = new Ext.Toolbar({
      items: [
        {
          xtype: 'exportbutton',
          hasMenu: false,
          gridBasename: 'EffectiveGrants',
          exportType: 'grid',
          iconCls: 'sm-export-icon',
          text: 'CSV',
          grid: this     
        }, {
          xtype: 'tbfill'
        }, {
          xtype: 'tbseparator'
        },
        totalTextCmp
      ]
    })

    const config = {
      isFormField: true,
      forceSelection: true,
      stripeRows: true,
      layout: 'fit',
      height: 150,
      store,
      columns,
      sm: new Ext.grid.RowSelectionModel({
        singleSelect: true
      }),
      view: new SM.ColumnFilters.GridView({
        emptyText: this.emptyText || 'No records to display',
        deferEmptyText: false,
        forceFit: true,
        markDirty: false
      }),
      bbar,
      setValue: function (v) {
        store.loadData(v)
      },
      getValue: function () { },
      markInvalid: function () { },
      clearInvalid: function () { },
      isValid: () => true,
      getName: () => this.name,
      validate: () => true
    }

    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.CollectionGrantGrid = Ext.extend(Ext.grid.GridPanel, {
  initComponent: function () {
    const _this = this
    const fields = ['collectionId', 'name', 'roleId']
    const sm = new Ext.grid.CheckboxSelectionModel({
      singleSelect: false,
      checkOnly: false,
      listeners: {
        selectionchange: function (sm) {
          SM.SetCheckboxSelModelHeaderState(sm)
        }
      }
    })

    const columns = [
      sm,
      {
        header: "Collection",
        width: 150,
        dataIndex: 'name',
        sortable: true,
        filter: { type: 'string' }
      },
      {
        header: "Role",
        width: 80,
        fixed: true,
        dataIndex: 'roleId',
        sortable: true,
        hidden: !this.showRole,
        renderer: (v) => `<div class="sm-grid-cell-with-menu">${SM.RoleStrings[v]}</div>`,
        filter: { type: 'values' }
      }
    ]
    const store = new Ext.data.JsonStore({
      fields,
      idProperty: 'collectionId',
      sortInfo: {
        field: 'name',
        direction: 'ASC'
      },
    })
    const totalTextCmp = new SM.RowCountTextItem({
      store,
      noun: 'collection',
      iconCls: 'sm-collection-icon'
    })

    const roleCellMenuItems = [
      {text: 'Role: Restricted', iconCls: 'sm-add-assignment-icon', roleId: 1, },
      {text: 'Role: Full', iconCls: 'sm-add-assignment-icon', roleId: 2, },
      {text: 'Role: Manage', iconCls: 'sm-add-assignment-icon', roleId: 3, },
      {text: 'Role: Owner', iconCls: 'sm-add-assignment-icon', roleId: 4, },
    ]

    const roleCellMenu = new Ext.menu.Menu({
      items: roleCellMenuItems,
      listeners: {
        itemclick: function (item) {
          this.currentRecord.data.roleId = item.roleId
          this.currentRecord.commit()
          _this.fireEvent('cellrolechanged')
        }
      }
    })

    function cellclick (grid, rowIndex, columnIndex, e) {
      const fieldName = grid.colModel.getDataIndex(columnIndex)
      if (fieldName === 'roleId') {
        roleCellMenu.currentRecord = grid.getStore().getAt(rowIndex)
        const cellEl = grid.view.getCell(rowIndex, columnIndex)
        const rect = cellEl.getBoundingClientRect()
        roleCellMenu.showAt([rect.left, rect.bottom])
      }
    }

    const listeners = {...this.initialConfig.listeners, cellclick}
    const config = {
      store,
      columns,
      sm,
      border: true,
      loadMask: false,
      stripeRows: true,
      view: new SM.ColumnFilters.GridView({
        forceFit: true,
        emptyText: 'No Collections to display',
        listeners: {
          filterschanged: function (view, item, value) {
            store.filter(view.getFilterFns())
          }
        }
      }),
      listeners,
      bbar: new Ext.Toolbar({
        items: [
          {
            xtype: 'exportbutton',
            grid: this,
            hasMenu: false,
            gridBasename: 'Collections (grid)',
            storeBasename: 'Collections (store)',
            iconCls: 'sm-export-icon',
            text: 'CSV'
          },
          {
            xtype: 'tbfill'
          },
          {
            xtype: 'tbseparator'
          },
          totalTextCmp
        ]
      })
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this);
  }
})

SM.User.GrantSelectingPanel = Ext.extend(Ext.Panel, {
  initComponent: function () {
    const _this = this
    const availableGrid = new SM.User.CollectionGrantGrid({
      title: 'Available',
      headerCssClass: 'sm-available-panel-header',
      role: 'available',
      flex: 1
    })
    const selectionsGrid = new SM.User.CollectionGrantGrid({
      title: this.selectionsGridTitle || 'Granted',
      showRole: true,
      headerCssClass: 'sm-selections-panel-header',
      role: 'selections',
      flex: 1,
      listeners: {
        cellrolechanged: fireSelectedChanged
      }
    })
    availableGrid.getSelectionModel().on('selectionchange', handleSelections, selectionsGrid)
    selectionsGrid.getSelectionModel().on('selectionchange', handleSelections, availableGrid)

    const addBtnMenuItems = [
      {text: 'Role: Restricted', iconCls: 'sm-add-assignment-icon', roleId: 1, handler: handleAddBtnItem},
      {text: 'Role: Full', iconCls: 'sm-add-assignment-icon', roleId: 2, handler: handleAddBtnItem},
      {text: 'Role: Manage', iconCls: 'sm-add-assignment-icon', roleId: 3, handler: handleAddBtnItem},
      {text: 'Role: Owner', iconCls: 'sm-add-assignment-icon', roleId: 4, handler: handleAddBtnItem},
    ]

    const addBtn = new Ext.Button({
      iconCls: 'sm-add-assignment-icon',
      margins: "0 10 10 10",
      disabled: true,
      getMenuClass: () => '',
      menu: new Ext.menu.Menu({
        items: addBtnMenuItems
      })
    })

    function fireSelectedChanged () {
      _this.fireEvent('selectedchanged', selectionsGrid.store.getRange().map( r => ({
        collectionId: r.data.collectionId,
        roleId: r.data.roleId
      })))
    }

    function handleAddBtnItem (menuItem) {
      const selectedRecords = availableGrid.getSelectionModel().getSelections()
      for (const record of selectedRecords) {
        record.data.roleId = menuItem.roleId
      }
      changeSelected(availableGrid, selectedRecords, selectionsGrid)
      fireSelectedChanged()
      addBtn.disable()
    }

    function changeSelected(srcGrid, records, dstGrid) {
      srcGrid.store.suspendEvents()
      dstGrid.store.suspendEvents()
      srcGrid.store.remove(records)
      dstGrid.store.add(records)
      const { field, direction } = dstGrid.store.getSortState()
      dstGrid.store.sort(field, direction)
      srcGrid.store.resumeEvents()
      dstGrid.store.resumeEvents()
      srcGrid.store.fireEvent('datachanged', srcGrid.store)
      dstGrid.store.fireEvent('datachanged', dstGrid.store)
      srcGrid.store.fireEvent('update', srcGrid.store)
      dstGrid.store.fireEvent('update', dstGrid.store)
      dstGrid.store.filter(dstGrid.getView().getFilterFns())

      dstGrid.getSelectionModel().selectRecords(records)
      dstGrid.getView().focusRow(dstGrid.store.indexOfId(records[0].data.assetId))
    }

    const removeBtn = new Ext.Button({
      iconCls: 'sm-remove-assignment-icon',
      margins: "0 10 10 10",
      disabled: true,
      handler: function (btn) {
        const selectedRecords = selectionsGrid.getSelectionModel().getSelections()
        changeSelected(selectionsGrid, selectedRecords, availableGrid)
        fireSelectedChanged()
        btn.disable()
      }
    })
    const buttonPanel = new Ext.Panel({
      bodyStyle: 'background-color:transparent;border:none',
      width: 60,
      layout: {
        type: 'vbox',
        pack: 'center',
        align: 'center',
        padding: "10 10 10 10"
      },
      items: [
        addBtn,
        removeBtn
      ]
    })

    function handleSelections() {
      const sm = this.selModel
      if (sm.hasSelection()) {
        sm.suspendEvents()
        sm.clearSelections()
        sm.resumeEvents()
        SM.SetCheckboxSelModelHeaderState(sm)
      }
      const availableSelected = availableGrid.selModel.hasSelection()
      const selectionsSelected = selectionsGrid.selModel.hasSelection()
      addBtn.setDisabled(!availableSelected)
      removeBtn.setDisabled(!selectionsSelected)
    }

    async function initPanel(apiUser) {
      const apiAvailableCollections = await Ext.Ajax.requestPromise({
        responseType: 'json',
        url: `${STIGMAN.Env.apiBase}/collections?elevate=true`,
        method: 'GET'
      })
      
      const assignedGrants = apiUser?.collectionGrants?.filter(grant => grant.grantees[0].userId).map(grant => ({
        collectionId: grant.collection.collectionId,
        name: grant.collection.name,
        roleId: grant.roleId
      })) ?? []
      const assignedCollectionIds = assignedGrants.map( g => g.collectionId)
      const availableCollections = apiAvailableCollections.filter(collection => !assignedCollectionIds.includes(collection.collectionId))

      availableGrid.store.loadData(availableCollections)
      selectionsGrid.store.loadData(assignedGrants)
    }

    function getValue() {
      const records = selectionsGrid.store.snapshot?.items ?? selectionsGrid.store.getRange()
      return records.map(record => ({
        collectionId: record.data.collectionId,
        roleId: record.data.roleId
      }))
    }

    const config = {
      layout: 'hbox',
      layoutConfig: {
        align: 'stretch',
        padding: 10
      },
      name: 'collectionGrants',
      items: [
        availableGrid,
        buttonPanel,
        selectionsGrid
      ],
      availableGrid,
      selectionsGrid,
      initPanel,
      getValue,
      // need fns below so Ext handles us like a form field
      setValue: () => { },
      markInvalid: function () { },
      clearInvalid: function () { },
      isValid: () => true,
      getName: () => this.name,
      validate: () => true
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.GroupSelectingGrid = Ext.extend(Ext.grid.GridPanel, {
  initComponent: function () {
    const _this = this
    const fields = Ext.data.Record.create([
      { name: 'userGroupId', type: 'string' },
      { name: 'name', type: 'string' },
      // { name: 'usernames', convert: (v, r) => r.users.map(user => user.username) },
    ])
    const sm = new Ext.grid.CheckboxSelectionModel({
      singleSelect: false,
      checkOnly: false,
      listeners: {
        selectionchange: function (sm) {
          SM.SetCheckboxSelModelHeaderState(sm)
        }
      }
    })
    const columns = [
      sm,
      {
        header: "Group name",
        width: 150,
        dataIndex: 'name',
        sortable: true,
        filter: { type: 'string' }
      },
      // {
      //   header: "Members",
      //   width: 50,
      //   align: 'center',
      //   dataIndex: 'usernames',
      //   sortable: true,
      //   hidden: false,
      //   filter: { type: 'values' },
      //   renderer: function (value, metadata, record) {
      //     let qtipWidth = 230
      //     if (value.length > 0) {
      //       let longest = Math.max(...(value.map(el => el.length)))
      //       qtipWidth = longest * 8
      //     }
      //     metadata.attr = ` ext:qwidth=${qtipWidth} ext:qtip="<b>${record.data.name} Members</b><br>${value.join('<br>')}"`
      //     return `<i>${value.length}</i>`
      //   }
      // }
    ]
    const store = new Ext.data.JsonStore({
      fields,
      idProperty: 'userGroupId',
      sortInfo: {
        field: 'name',
        direction: 'ASC'
      },
    })
    const totalTextCmp = new SM.RowCountTextItem({
      store,
      noun: 'group',
      iconCls: 'sm-users-icon'
    })
    const config = {
      store,
      columns,
      sm,
      enableDragDrop: true,
      ddText: '{0} selected Group{1}',
      bodyCssClass: 'sm-grid3-draggable',
      ddGroup: `SM.User.GroupSelectingGrid-${this.role}`,
      border: true,
      loadMask: false,
      stripeRows: true,
      view: new SM.ColumnFilters.GridView({
        forceFit: true,
        emptyText: 'No Groups to display',
        listeners: {
          filterschanged: function (view, item, value) {
            store.filter(view.getFilterFns())
          }
        }
      }),
      bbar: new Ext.Toolbar({
        items: [
          {
            xtype: 'exportbutton',
            grid: this,
            hasMenu: false,
            gridBasename: 'Groups (grid)',
            storeBasename: 'Groups (store)',
            iconCls: 'sm-export-icon',
            text: 'CSV'
          },
          {
            xtype: 'tbfill'
          },
          {
            xtype: 'tbseparator'
          },
          totalTextCmp
        ]
      })
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this);
  }
})

SM.User.GroupSelectingPanel = Ext.extend(Ext.Panel, { initComponent: 
  function () {
    const _this = this
    function setupDragZone(grid) {
      const gridDragZone = grid.getView().dragZone
      const originalGetDragData = gridDragZone.getDragData
      gridDragZone.getDragData = function (e) {
        const t = Ext.lib.Event.getTarget(e)
        if (t.className === 'x-grid3-row-checker') {
          return false
        }
        return originalGetDragData.call(gridDragZone, e)
      }

      const originalStartDrag = gridDragZone.startDrag
      gridDragZone.startDrag = function (x, y) {
        Ext.getBody().addClass('sm-grabbing')
        return originalStartDrag.call(gridDragZone, x, y)
      }

      const originalOnDragDrop = gridDragZone.onDragDrop
      gridDragZone.onDragDrop = function (e, id) {
        Ext.getBody().removeClass('sm-grabbing')
        return originalOnDragDrop.call(gridDragZone, e, id)
      }

      const originalOnInvalidDrop = gridDragZone.onInvalidDrop
      gridDragZone.onInvalidDrop = function (e, id) {
        Ext.getBody().removeClass('sm-grabbing')
        return originalOnInvalidDrop.call(gridDragZone, e)
      }

    }
    const availableGrid = new SM.User.GroupSelectingGrid({
      title: 'Available',
      headerCssClass: 'sm-available-panel-header',
      role: 'available',
      flex: 1,
      listeners: {
        render: function (grid) {
          setupDragZone(grid)
          const gridDropTargetEl = grid.getView().scroller.dom;
          const gridDropTarget = new Ext.dd.DropTarget(gridDropTargetEl, {
            ddGroup: selectionsGrid.ddGroup,
            notifyDrop: function (ddSource, e, data) {
              const selectedRecords = ddSource.dragData.selections;
              changeSelected(selectionsGrid, selectedRecords, availableGrid)
              return true
            }
          })
        }
      }
    })
    const selectionsGrid = new SM.User.GroupSelectingGrid({
      title: this.selectionsGridTitle || 'Assigned',
      headerCssClass: 'sm-selections-panel-header',
      role: 'selections',
      flex: 1,
      listeners: {
        render: function (grid) {
          setupDragZone(grid)
          const gridDropTargetEl = grid.getView().scroller.dom;
          const gridDropTarget = new Ext.dd.DropTarget(gridDropTargetEl, {
            ddGroup: availableGrid.ddGroup,
            notifyDrop: function (ddSource, e, data) {
              const selectedRecords = ddSource.dragData.selections;
              changeSelected(availableGrid, selectedRecords, selectionsGrid)
              return true
            }
          })
        }
      }
    })
    availableGrid.getSelectionModel().on('selectionchange', handleSelections, selectionsGrid)
    selectionsGrid.getSelectionModel().on('selectionchange', handleSelections, availableGrid)

    const addBtn = new Ext.Button({
      iconCls: 'sm-add-assignment-icon',
      margins: "0 10 10 10",
      disabled: true,
      handler: function (btn) {
        const selectedRecords = availableGrid.getSelectionModel().getSelections()
        changeSelected(availableGrid, selectedRecords, selectionsGrid)
        btn.disable()
      }
    })
    const removeBtn = new Ext.Button({
      iconCls: 'sm-remove-assignment-icon',
      margins: "0 10 10 10",
      disabled: true,
      handler: function (btn) {
        const selectedRecords = selectionsGrid.getSelectionModel().getSelections()
        changeSelected(selectionsGrid, selectedRecords, availableGrid)
        btn.disable()
      }
    })
    const buttonPanel = new Ext.Panel({
      bodyStyle: 'background-color:transparent;border:none',
      width: 60,
      layout: {
        type: 'vbox',
        pack: 'center',
        align: 'center',
        padding: "10 10 10 10"
      },
      items: [
        addBtn,
        removeBtn,
        { xtype: 'panel', border: false, html: '<i>or drag</i>' }
      ]
    })

    function handleSelections() {
      const sm = this.selModel
      if (sm.hasSelection()) {
        sm.suspendEvents()
        sm.clearSelections()
        sm.resumeEvents()
        SM.SetCheckboxSelModelHeaderState(sm)
      }
      const availableSelected = availableGrid.selModel.hasSelection()
      const selectionsSelected = selectionsGrid.selModel.hasSelection()
      addBtn.setDisabled(!availableSelected)
      removeBtn.setDisabled(!selectionsSelected)
    }

    function fireSelectedChanged () {
      _this.fireEvent('selectedchanged', selectionsGrid.store.getRange().map( r => r.data.userGroupId ))
    }


    async function initPanel(apiUser) {
      const apiAvailableUserGroups = await Ext.Ajax.requestPromise({
        responseType: 'json',
        url: `${STIGMAN.Env.apiBase}/user-groups`,
        params: {
          projection: ['users']
        },
        method: 'GET'
      })
      
      const assignedUserGroupIds = apiUser?.userGroups?.map(userGroup => userGroup.userGroupId) ?? []
      _this.originalUserGroupIds = assignedUserGroupIds
      const availableUserGroups = []
      const assignedUserGroups = []
      apiAvailableUserGroups.reduce((accumulator, userGroup) => {
        const property = assignedUserGroupIds.includes(userGroup.userGroupId) ? 'assignedUserGroups' : 'availableUserGroups'
        accumulator[property].push(userGroup)
        return accumulator
      }, { availableUserGroups, assignedUserGroups })

      availableGrid.store.loadData(availableUserGroups)
      selectionsGrid.store.loadData(assignedUserGroups)
      // _this.trackedProperty = { dataProperty: 'usernames', value: apiUser.username }

    }

    function changeSelected(srcGrid, records, dstGrid) {
      srcGrid.store.suspendEvents()
      dstGrid.store.suspendEvents()
      srcGrid.store.remove(records)
      dstGrid.store.add(records)
      // for (const record of records) {
      //   if (srcGrid.role === 'available') {
      //     record.data[_this.trackedProperty.dataProperty].push(_this.trackedProperty.value)
      //     record.commit()
      //   }
      //   else {
      //     record.data[_this.trackedProperty.dataProperty] = record.data[_this.trackedProperty.dataProperty].filter(i => i !== _this.trackedProperty.value)
      //     record.commit()
      //   }
      // }
      const { field, direction } = dstGrid.store.getSortState()
      dstGrid.store.sort(field, direction)
      dstGrid.selModel.selectRecords(records)
      srcGrid.store.resumeEvents()
      dstGrid.store.resumeEvents()

      srcGrid.store.fireEvent('datachanged', srcGrid.store)
      dstGrid.store.fireEvent('datachanged', dstGrid.store)
      srcGrid.store.fireEvent('update', srcGrid.store)
      dstGrid.store.fireEvent('update', dstGrid.store)
      dstGrid.store.filter(dstGrid.getView().getFilterFns())
      dstGrid.getView().focusRow(dstGrid.store.indexOfId(records[0].data.assetId))

      fireSelectedChanged()
    }

    function getValue() {
      const records = selectionsGrid.store.snapshot?.items ?? selectionsGrid.store.getRange()
      return records.map(record => record.data.userGroupId)
    }

    const config = {
      layout: 'hbox',
      layoutConfig: {
        align: 'stretch',
        padding: 10
      },
      name: 'userGroups',
      items: [
        availableGrid,
        buttonPanel,
        selectionsGrid
      ],
      availableGrid,
      selectionsGrid,
      initPanel,
      getValue,
      // need fns below so Ext handles us like a form field
      setValue: () => { },
      markInvalid: function () { },
      clearInvalid: function () { },
      isValid: () => true,
      getName: () => this.name,
      validate: () => true
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.UserGrid = Ext.extend(Ext.grid.GridPanel, {
  initComponent: function () {
    const _this = this
    const fields = [
      {
        name: 'userId',
        type: 'string'
      },
      {
        name: 'username',
        type: 'string'
      },
      {
        name: 'displayName',
        type: 'string'
      },
      {
        name: 'groupNames',
        convert: (v, r) => r.userGroups.map(userGroup => userGroup.name)
      },
      {
        name: 'created',
        type: 'date',
        mapping: 'statistics.created'
      },
      {
        name: 'lastAccess',
        type: 'integer'
      },
      {
        name: 'collectionGrantCount',
        type: 'integer',
        mapping: 'statistics.collectionGrantCount'
      },
      'statistics',
      'privileges'
    ]
    const store = new Ext.data.JsonStore({
      proxy: new Ext.data.HttpProxy({
        url: `${STIGMAN.Env.apiBase}/users`,
        method: 'GET'
      }),
      baseParams: {
        elevate: curUser.privileges.admin,
        projection: ['userGroups', 'statistics']
      },
      root: '',
      fields,
      idProperty: 'userId',
      sortInfo: {
        field: 'username',
        direction: 'ASC' // or 'DESC' (case sensitive for local sorting)
      },
      listeners: {
        load: function () {
          _this.selModel.selectRow(0)
        }
      }
    })
    const totalTextCmp = new SM.RowCountTextItem({ store })
    const config = {
      store,
      sm: new Ext.grid.RowSelectionModel({ singleSelect: true }),
      columns: [
        {
          header: "Username",
          width: 150,
          dataIndex: 'username',
          sortable: true,
          filter: { type: 'string' }
        },
        {
          header: "Name",
          width: 150,
          dataIndex: 'displayName',
          sortable: true,
          filter: { type: 'string' }
        },
        {
          header: "Groups",
          width: 220,
          dataIndex: 'groupNames',
          sortable: false,
          filter: {
            type: 'values',
            renderer: SM.ColumnFilters.Renderers.groups
          },
          renderer: function (value, metadata) {
            value.sort((a, b) => a.localeCompare(b))
            metadata.attr = 'style="line-height: 17px;white-space:normal;"'
            return SM.User.GroupArrayTpl.apply(value)
          }
        },
        {
          header: "Grants",
          width: 50,
          align: 'center',
          dataIndex: 'collectionGrantCount',
          sortable: true,
        },
        {
          header: "Added",
          xtype: 'datecolumn',
          format: 'Y-m-d H:i T',
          width: 150,
          dataIndex: 'created',
          sortable: true
        },
        {
          header: "Last Access",
          width: 150,
          dataIndex: 'lastAccess',
          sortable: true,
          renderer: v => v ? Ext.util.Format.date(new Date(v * 1000), 'Y-m-d H:i T') : SM.styledEmptyRenderer()
        },
        {
          header: "Create Collection",
          width: 100,
          align: 'center',
          renderer: function (value, metaData, record) {
            return record.data.privileges.create_collection ? '&#x2714;' : ''
          }
        },
        {
          header: "Administrator",
          width: 100,
          align: 'center',
          renderer: function (value, metaData, record) {
            return record.data.privileges.admin ? '&#x2714;' : ''
          }
        },
        {
          header: "userId",
          width: 100,
          dataIndex: 'userId',
          sortable: true
        }
      ],
      view: new SM.ColumnFilters.GridView({
        forceFit: true,
        listeners: {
          filterschanged: function (view) {
            store.filter(view.getFilterFns())
          },
          // These listeners keep the grid in the same scroll position after the store is reloaded
          beforerefresh: function (v) {
            v.scrollTop = v.scroller.dom.scrollTop;
            v.scrollHeight = v.scroller.dom.scrollHeight;
          },
          refresh: function (v) {
            setTimeout(function () {
              v.scroller.dom.scrollTop = v.scrollTop + (v.scrollTop == 0 ? 0 : v.scroller.dom.scrollHeight - v.scrollHeight);
            }, 100);
          }
        },
        deferEmptyText: false
      }),
      listeners: {
        rowdblclick: function (grid, rowIndex, e) {
          let r = grid.getStore().getAt(rowIndex);
          SM.User.showUserProps(r.get('userId'));
        }
      },
      tbar: [
        {
          iconCls: 'icon-add',
          text: 'Pre-register User',
          handler: function () {
            Ext.getBody().mask('');
            SM.User.showUserProps(0);
          }
        },
        '-',
        {
          ref: '../removeBtn',
          iconCls: 'icon-del',
          text: 'Unregister User',
          handler: function () {
            let user = _this.getSelectionModel().getSelected();
            let buttons = { yes: 'Unregister', no: 'Cancel' }
            let confirmStr = `Unregister user ${user.data.username}?<br><br>This action will remove all Collection Grants for the user. A record will be retained in the system for auditing and attribution purposes.`;
            if (user.data.lastAccess === 0) {
              confirmStr = `Delete user ${user.data.username}?<br><br>This user has never accessed the system, and will be deleted from the system entirely.`;
              buttons.yes = 'Delete'
            }

            Ext.Msg.show({
              title: 'Confirm unregister action',
              icon: Ext.Msg.WARNING,
              msg: confirmStr,
              buttons: buttons,
              fn: async function (btn, text) {
                try {
                  if (btn == 'yes') {
                    if (user.data.lastAccess === 0) {
                      const apiUser = await Ext.Ajax.requestPromise({
                        responseType: 'json',
                        url: `${STIGMAN.Env.apiBase}/users/${user.data.userId}?elevate=${curUser.privileges.admin}`,
                        method: 'DELETE'
                      })
                      store.remove(user)
                      SM.Dispatcher.fireEvent('userdeleted', apiUser)
                    }
                    else {
                      const apiUser = await Ext.Ajax.requestPromise({
                        responseType: 'json',
                        url: `${STIGMAN.Env.apiBase}/users/${user.data.userId}?elevate=${curUser.privileges.admin}&projection=collectionGrants&projection=statistics&projection=userGroups`,
                        method: 'PATCH',
                        jsonData: {
                          collectionGrants: [],
                          userGroups: [],
                        }
                      })
                      // userStore.remove(user)
                      SM.Dispatcher.fireEvent('userchanged', apiUser)
                    }
                  }
                }
                catch (e) {
                  SM.Error.handleError(e)
                }
              }
            })
          }
        },
        '-',
        {
          iconCls: 'icon-edit',
          text: 'Modify User',
          handler: function () {
            var r = _this.getSelectionModel().getSelected();
            Ext.getBody().mask('Getting properties...');
            SM.User.showUserProps(r.get('userId'));
          }
        }
      ],
      bbar: new Ext.Toolbar({
        items: [
          {
            xtype: 'tbbutton',
            iconCls: 'icon-refresh',
            tooltip: 'Reload this grid',
            width: 20,
            handler: function (btn) {
              store.reload()
            }
          },
          {
            xtype: 'tbseparator'
          },
          {
            xtype: 'exportbutton',
            hasMenu: false,
            gridBasename: 'User-Info',
            exportType: 'grid',
            iconCls: 'sm-export-icon',
            text: 'CSV',
            grid: this     
          },
          {
            xtype: 'tbfill'
          }, {
            xtype: 'tbseparator'
          },
          totalTextCmp
        ]
      })
    }


    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.PropertiesPanel = Ext.extend(Ext.Panel, {
  initComponent: function () {
    const _this = this

    const directGrantsPanel = new SM.User.GrantSelectingPanel({
      name: 'collectionGrants',
      title: 'Direct Grants',
      iconCls: 'sm-lock-icon',
      border: false,
      listeners: {
        selectedchanged: function (selections) {
          _this.fireEvent('propsupdate', this.name, selections)
        }
      }
    })
    const userGroupsPanel = new SM.User.GroupSelectingPanel({
      title: 'User Groups',
      iconCls: 'sm-users-icon',
      padding: '10 10 10 10',
      border: false,
      isFormField: true,
      submitValue: true,
      listeners: {
        selectedchanged: function (selections) {
          _this.fireEvent('propsupdate', this.name, selections)
        }
      }
    })
    const effectiveGrantsGrid = new SM.User.EffectiveGrantsGrid({
      name: 'effectiveGrants',
      title: 'Effective Grants',
      iconCls: 'sm-lock-icon',
      isFormField: true,
      border: true
    })
    const lastClaimsPanel = new Ext.Panel({
      title: 'Last Claims',
      name: 'lastClaims',
      html: '',
      tree: JsonView.createTree({status: 'No claims have been presented.'}),
      autoScroll: true,
      iconCls: 'sm-json-icon',
      layout: 'fit',
      isFormField: true,
      setValue: function (v) {
        if (Object.keys(v).length === 0 && v.constructor === Object) {
          return
        }
        this.tree = JsonView.createTree(v)
      },
      getValue: Ext.emptyFn,
      markInvalid: Ext.emptyFn,
      clearInvalid: Ext.emptyFn,
      isValid: () => true,
      getName: function () { return this.name },
      validate: () => true,
      listeners: {
        render: function () {
          JsonView.render(this.tree, this.body.dom)
          JsonView.expandChildren(this.tree)
        }
      }
    })

    const config = {
      layout: 'accordion',
      layoutConfig: {
        animate: true
      },
      items: [
        userGroupsPanel,
        directGrantsPanel,
        effectiveGrantsGrid,
        lastClaimsPanel
      ]
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.UserFormPanel = Ext.extend(Ext.form.FormPanel, {
  initComponent: function () {
    const _this = this
    const directGrantsPanel = new SM.User.GrantSelectingPanel({
      name: 'collectionGrants',
      title: 'Direct Grants',
      iconCls: 'sm-lock-icon',
      border: true,
      listeners: {
        selectedchanged: function (selections) {
          _this.fireEvent('propsupdate', this.name, selections)
        }
      }
    })
    const userGroupsPanel = new SM.User.GroupSelectingPanel({
      title: 'User Groups',
      iconCls: 'sm-users-icon',
      border: true,
      isFormField: true,
      submitValue: true,
      listeners: {
        selectedchanged: function (selections) {
          _this.fireEvent('propsupdate', this.name, selections)
        }
      }
    })
    const effectiveGrantsGrid = new SM.User.EffectiveGrantsGrid({
      name: 'effectiveGrants',
      title: 'Effective Grants',
      iconCls: 'sm-lock-icon',
      isFormField: true,
      border: true
    })
    const lastClaimsPanel = new Ext.Panel({
      title: 'Last Claims',
      name: 'lastClaims',
      border: true,
      html: '',
      tree: JsonView.createTree({status: 'No claims have been presented.'}),
      autoScroll: true,
      iconCls: 'sm-json-icon',
      layout: 'fit',
      isFormField: true,
      setValue: function (v) {
        if (Object.keys(v).length === 0 && v.constructor === Object) {
          return
        }
        this.tree = JsonView.createTree(v)
      },
      getValue: Ext.emptyFn,
      markInvalid: Ext.emptyFn,
      clearInvalid: Ext.emptyFn,
      isValid: () => true,
      getName: function () { return this.name },
      validate: () => true,
      listeners: {
        render: function () {
          JsonView.render(this.tree, this.body.dom)
          JsonView.expandChildren(this.tree)
        }
      }
    })
    const registeredUserItems = [
      {
        layout: 'column',
        baseCls: 'x-plain',
        border: false,
        items: [
          {
            columnWidth: .5,
            layout: 'form',
            border: false,
            items: [
              {
                xtype: 'textfield',
                fieldLabel: 'Username',
                readOnly: true,
                anchor: '-20',
                name: 'username'
              }
            ]
          },
          {
            columnWidth: .5,
            layout: 'form',
            border: false,
            items: [
              {
                xtype: 'textfield',
                fieldLabel: 'Name',
                readOnly: true,
                anchor: '100%',
                name: 'displayName'
              }
            ]
          }
        ]
      },
      {
        xtype: 'textfield',
        fieldLabel: 'Email',
        anchor: '100%',
        readOnly: true,
        name: 'email'
      },
      {
        xtype: 'textfield',
        fieldLabel: 'Privileges',
        anchor: '100%',
        readOnly: true,
        name: 'privileges'
      }
    ]
    const preregisteredUserItems = [
      {
        xtype: 'textfield',
        fieldLabel: 'Username',
        allowBlank: false,
        anchor: '100%',
        name: 'username'
      }
    ]
    const registeredTabPanelItems = [
      userGroupsPanel,
      directGrantsPanel,
      effectiveGrantsGrid,
      lastClaimsPanel
    ]
    const preregisteredTabPanelItems = [
      userGroupsPanel,
      directGrantsPanel
    ]

    let config = {
      baseCls: 'x-plain',
      labelWidth: 70,
      items: [
        {
          xtype: 'fieldset',
          title: '<b>User information</b>',
          items: this.registeredUser ? registeredUserItems : preregisteredUserItems
        },
        {
          xtype: 'tabpanel',
          border: false,
          activeTab: 0,
          anchor: `100% ${this.registeredUser ? '-130' : '-85'}`,
          // height: 270,
          items: this.registeredUser ? registeredTabPanelItems : preregisteredTabPanelItems
        }
      ],
      userGroupsPanel,
      directGrantsPanel,
      effectiveGrantsGrid
    }
    Ext.apply(this, Ext.apply(this.initialConfig, config))
    this.superclass().initComponent.call(this)
  }
})

SM.User.showUserProps = async function showUserProps(userId) {
  try {
    const listeners = {}
    if (userId) {
      listeners.propsupdate = onPropsUpdate //live updates for registered users
    }
    else {
      listeners.clientvalidation = onClientValidation
    }
    const userFormPanel = new SM.User.UserFormPanel({
      registeredUser: userId,
      padding: '10px 15px 10px 15px',
      listeners,
      monitorValid: !userId //fires clientvalidation event for preregistered users,
    })

    async function onPropsUpdate(property, value) {
      const apiUser = await Ext.Ajax.requestPromise({
        responseType: 'json',
        url: `${STIGMAN.Env.apiBase}/users/${userId}`,
        method: 'PATCH',
        params: {
          elevate: curUser.privileges.admin,
          projection: ['userGroups', 'collectionGrants', 'statistics']
        },
        headers: { 'Content-Type': 'application/json;charset=utf-8' },
        jsonData: {
          [property]: value
        }
      })
      userFormPanel.effectiveGrantsGrid.setValue(apiUser.collectionGrants)
      SM.Dispatcher.fireEvent('userchanged', apiUser)
    }

    function onClientValidation(formPanel, isValid) {
      formPanel.ownerCt.buttons[0].setDisabled(!isValid)
    }

    async function windowBtnHandler(btn) {
      if (btn.action === 'close') {
        appwindow.close()
      }
      else if (btn.action === 'save') {
        try {
          if (userFormPanel.getForm().isValid()) {
            const values = userFormPanel.getForm().getFieldValues()
            const apiUser = await Ext.Ajax.requestPromise({
              responseType: 'json',
              url: `${STIGMAN.Env.apiBase}/users`,
              method: 'POST',
              params: {
                elevate: curUser.privileges.admin,
                projection: ['userGroups', 'collectionGrants', 'statistics']
              },
              headers: { 'Content-Type': 'application/json;charset=utf-8' },
              jsonData: values
            })
            const event = userId ? 'userchanged' : 'usercreated'
            SM.Dispatcher.fireEvent(event, apiUser)
            appwindow.close()
          }
        }
        catch (e) {
          SM.Error.handleError(e)
        }

      }
    }

    const appwindow = new Ext.Window({
      title: userId ? 'User ID ' + userId : 'Pre-register User',
      cls: 'sm-dialog-window sm-round-panel',
      modal: true,
      hidden: true,
      width: 660,
      height: userId ? 650 : 440,
      layout: 'fit',
      plain: true,
      bodyStyle: 'padding:5px;',
      buttonAlign: 'right',
      items: userFormPanel,
      buttons: [{
        text: userId ? 'Close' : 'Save',
        action: userId ? 'close' : 'save',
        handler: windowBtnHandler
      }]
    })

    appwindow.show(Ext.getBody())

    let apiUser
    if (userId) {
      apiUser = await Ext.Ajax.requestPromise({
        responseType: 'json',
        url: `${STIGMAN.Env.apiBase}/users/${userId}`,
        params: {
          elevate: curUser.privileges.admin,
          projection: ['statistics', 'collectionGrants', 'userGroups']
        },
        method: 'GET'
      })
      for (const claim of ['iat', 'exp', 'auth_time']) {
        if (apiUser.statistics.lastClaims[claim]) {
          apiUser.statistics.lastClaims[claim] = new Date(apiUser.statistics.lastClaims[claim] * 1000)
        }
      }
      if (apiUser.statistics.lastClaims.scope) {
        apiUser.statistics.lastClaims.scope = apiUser.statistics.lastClaims.scope.split(' ')
      }
      const privileges = []
      for (const privilege in apiUser.privileges) {
        if (apiUser.privileges[privilege]) privileges.push(privilege)
      }
      const formValues = {
        username: apiUser.username,
        displayName: apiUser.displayName,
        email: apiUser.email,
        privileges: privileges.join(', '),
        canCreateCollection: privileges.includes('create_collection'),
        canAdmin: privileges.includes('admin'),
        lastClaims: apiUser.statistics.lastClaims,
        // collectionGrants: apiUser.collectionGrants || [],
        effectiveGrants: apiUser.collectionGrants || []
      }
      userFormPanel.getForm().setValues(formValues)
    }
    await userFormPanel.userGroupsPanel.initPanel(apiUser)
    await userFormPanel.directGrantsPanel.initPanel(apiUser)

    Ext.getBody().unmask();
  }
  catch (e) {
    Ext.getBody().unmask()
    SM.Error.handleError(e)
  }
}

SM.User.CollectionAclGrid = Ext.extend(Ext.grid.GridPanel, {
  initComponent: function () {
      const fields = [
        {
          name: 'assetName',
          mapping: 'asset.name'
        },
        'benchmarkId',
        'access',
        'aclSources'
      ]
      const store = new Ext.data.JsonStore({
        autoLoad: true,
        proxy: new Ext.data.HttpProxy({
          url: `${STIGMAN.Env.apiBase}/collections/${this.collectionId}/users/${this.userId}/effective-acl`,
          method: 'GET'
        }),
        root: '',
        fields,
        idProperty: 'assetName',
        sortInfo: {
          field: 'assetName',
          direction: 'ASC' // or 'DESC' (case sensitive for local sorting)
        }
      })
      const columns = [
        {
          header: `<span class="sm-asset-icon sm-column-with-icon">Asset</span>`, 
          dataIndex: 'assetName',
          sortable: true,
          width: 250
        },
        {
          header: `<span class="sm-stig-icon sm-column-with-icon">STIG</span>`, 
          dataIndex: 'benchmarkId',
          sortable: true,
          width: 350
        },
        {
          header: `Access`, 
          dataIndex: 'access',
          sortable: true,
          width: 150
        },
        {
          header: 'ACL Source',
          width: 150,
          dataIndex: 'aclSources',
          sortable: false,
          renderer: function (aclSources) {
            const divs = []
            for (const source of aclSources) {
              const icon = source.grantee.userId ? 'sm-user-icon' : 'sm-users-icon'
              const title = source.grantee.userId ? 'Direct' : source.grantee.name
              divs.push(`<div class="x-combo-list-item ${icon} sm-combo-list-icon" exportValue="${title}">
                      <span style="font-weight:600;">${title}</span></div>`)
            }
            return divs.join('')
          }
        }
      ]
      const sm = new Ext.grid.RowSelectionModel({
        singleSelect: true
      })
      const view = new SM.ColumnFilters.GridView({
        emptyText: this.emptyText || 'No records to display',
        deferEmptyText: false,
        forceFit: true,
        markDirty: false
      })

      const totalTextCmp = new SM.RowCountTextItem({ store })

      const bbar = new Ext.Toolbar({
        items: [
          {
            xtype: 'tbbutton',
            iconCls: 'icon-refresh',
            tooltip: 'Reload this grid',
            width: 20,
            handler: function (btn) {
              store.reload()
            }
          },
          {
            xtype: 'tbseparator'
          },
          {
            xtype: 'exportbutton',
            hasMenu: false,
            gridBasename: 'Collection ACL',
            exportType: 'grid',
            iconCls: 'sm-export-icon',
            text: 'CSV',
            grid: this
          },
          {
            xtype: 'tbfill'
          },
          {
            xtype: 'tbseparator'
          },
          totalTextCmp
        ]
      })

      const config = {
        fields,
        store,
        columns,
        sm,
        view,
        stripeRows: true,
        layout: 'fit',
        loadMask: true,
        bbar
      }
      Ext.apply(this, Ext.apply(this.initialConfig, config))
      this.superclass().initComponent.call(this)
  }
})

SM.User.showCollectionAcl = async function ({userId, displayName, collectionId, defaultAccess}) {
  const aclGrid = new SM.User.CollectionAclGrid({
    userId,
    displayName,
    collectionId,
    border: false,
    title: `Effective Access, default = ${defaultAccess}`
  })
  const appwindow = new Ext.Window({
    title: 'User: ' + displayName,
    cls: 'sm-dialog-window sm-round-panel',
    modal: true,
    hidden: true,
    width: 660,
    height: 650,
    layout: 'fit',
    plain: true,
    bodyStyle: 'padding:15px;',
    buttonAlign: 'right',
    items: aclGrid
  })
  appwindow.show(Ext.getBody());
}

SM.User.showUserAdmin = function (params) {
	let { treePath } = params
	const tab = Ext.getCmp('main-tab-panel').getItem('user-admin-tab')
	if (tab) {
		tab.show()
		return
	}

	const userGrid = new SM.User.UserGrid({
		cls: 'sm-round-panel',
		border: false,
		margins: { top: SM.Margin.top, right: SM.Margin.edge, bottom: SM.Margin.bottom, left: SM.Margin.edge },
		region: 'center',
		stripeRows:true,
		loadMask: {msg: ''}
	})

	const onUserChanged = function (apiUser) {
		userGrid.store.loadData(apiUser, true)
		const sortState = userGrid.store.getSortState()
		userGrid.store.sort(sortState.field, sortState.direction)
		userGrid.getSelectionModel().selectRow(userGrid.store.findExact('userId',apiUser.userId))
	}
	SM.Dispatcher.addListener('userchanged', onUserChanged)
	SM.Dispatcher.addListener('usercreated', onUserChanged)


	const thisTab = Ext.getCmp('main-tab-panel').add({
		id: 'user-admin-tab',
		sm_treePath: treePath, 
		iconCls: 'sm-user-icon',
		title: 'Users',
		closable:true,
		layout: 'fit',
		border: false,
		items: [userGrid],
		listeners: {
			beforedestroy: function(grid) {
				SM.Dispatcher.removeListener('userchanged', onUserChanged)
				SM.Dispatcher.removeListener('usercreated', onUserChanged)
			}
		}
	})
	thisTab.show()
	
	userGrid.getStore().load()
}

