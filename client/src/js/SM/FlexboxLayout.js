SM.FlexboxLayout = Ext.extend(Ext.layout.ContainerLayout, {
  onLayout : function(ct, target){
    target.addClass('sm-flexbox-layout-ct');
    this.renderAll(ct, target); 
  },
  renderItem : function(c, position, target){
    if(c && !c.rendered){
        c.render(target);
        this.configureItem(c);
    }
  }
})
Ext.Container.LAYOUTS['sm-flexbox'] = SM.FlexboxLayout
