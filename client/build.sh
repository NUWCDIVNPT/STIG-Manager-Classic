#!/bin/bash

# STIG Manager client distribution build script
#
# Requires nodejs and npm to install uglify-js
# npm install -g uglify-js
#
# Build artifacts will created in ./dist

set -e
echo "Client build starting"

# Change to this script directory
ScriptDir=$(dirname "$(realpath "$0")") 
cd $ScriptDir
echo "Changed to $ScriptDir"


SrcDir=src
DistDir=dist

# Clean dist directory
echo "Cleaning $DistDir"
rm -rf $DistDir/*

# ExtJS
echo "Preparing ExtJS resources"
ExtResources="ext/adapter/ext/ext-base.js
ext/ext-all.js
ext/ux/GroupSummary.js
ext/resources/css/ext-all.css
ext/resources/css/xtheme-gray.css
ext/resources/images/default/shadow-c.png
ext/resources/images/default/shadow-lr.png
ext/resources/images/default/shadow.png
ext/resources/images/default/button/arrow.gif
ext/resources/images/default/dd/drop-no.gif
ext/resources/images/default/grid/loading.gif
ext/resources/images/default/grid/hmenu-asc.gif
ext/resources/images/default/grid/hmenu-desc.gif
ext/resources/images/default/grid/columns.gif
ext/resources/images/default/grid/grid-split.gif
ext/resources/images/default/grid/grid3-special-col-bg.gif
ext/resources/images/default/menu/menu.gif
ext/resources/images/default/tree/loading.gif
ext/resources/images/gray/button/btn.gif
ext/resources/images/gray/button/group-cs.gif
ext/resources/images/gray/button/group-tb.gif
ext/resources/images/gray/button/group-lr.gif
ext/resources/images/gray/form/trigger.gif
ext/resources/images/gray/form/clear-trigger.gif
ext/resources/images/gray/grid/col-move-bottom.gif
ext/resources/images/gray/grid/col-move-top.gif
ext/resources/images/gray/grid/grid3-special-col-sel-bg.gif
ext/resources/images/gray/grid/sort_asc.gif
ext/resources/images/gray/grid/sort_desc.gif
ext/resources/images/gray/menu/group-checked.gif
ext/resources/images/gray/menu/item-over.gif
ext/resources/images/gray/menu/item-over-disabled.gif
ext/resources/images/gray/menu/menu-parent.gif
ext/resources/images/gray/panel/tool-sprites.gif
ext/resources/images/gray/panel/white-top-bottom.gif
ext/resources/images/gray/qtip/tip-anchor-sprite.gif
ext/resources/images/gray/qtip/tip-sprite.gif
ext/resources/images/gray/tabs/tab-close.gif
ext/resources/images/gray/tabs/scroll-left.gif
ext/resources/images/gray/tabs/scroll-right.gif
ext/resources/images/gray/window/icon-question.gif
ext/ux/css/LockingGridView.css
ext/ux/fileuploadfield/css/fileuploadfield.css"
tar cf - -C $SrcDir --files-from <(echo "${ExtResources}") | tar xf - -C $DistDir

# CSS
echo "Preparing CSS resources"
cp -r $SrcDir/css $DistDir

# Fonts
echo "Preparing font resources"
cp -r $SrcDir/fonts $DistDir

# Images
echo "Preparing image resources"
cp -r $SrcDir/img $DistDir

# HTML
echo "Preparing HTML resources"
cp -r $SrcDir/index.html $DistDir/index.html

# Service Worker
echo "Preparing Service Worker resources"
cp -r $SrcDir/serviceWorker.js $DistDir/serviceWorker.js

# npm
echo "Preparing npm resources"
cd $SrcDir/js/modules
npm install
cd $ScriptDir

# JS
echo "Preparing JavaScript resources"
mkdir $DistDir/js
cp $SrcDir/js/resources-dist.js $DistDir/js/resources.js
cp $SrcDir/js/init.js $DistDir/js/init.js
cp $SrcDir/js/Env.js.example $DistDir/js
cp -r $SrcDir/js/modules $DistDir/js/modules
cd $SrcDir/js
uglifyjs \
'diff.js' \
'diff2html.min.js' \
'stigmanUtils.js' \
'SM/Global.js' \
'SM/StackTrace.js' \
'SM/Error.js' \
'SM/FlexboxLayout.js' \
'BufferView.js' \
'SM/EventDispatcher.js' \
'SM/Cache.js' \
'SM/ServiceWorker.js' \
'SM/State.js' \
'SM/TipContent.js' \
'SM/Ajax.js' \
'SM/Warnings.js' \
'SM/Classification.js' \
'SM/MainPanel.js' \
'SM/WhatsNew.js' \
'FileUploadField.js' \
'MessageBox.js' \
'overrides.js' \
'RowEditor.js' \
'RowExpander.js' \
'SM/SelectingGridToolbar.js' \
'SM/NavTree.js' \
'SM/RowEditorToolbar.js' \
'SM/BatchReview.js' \
'SM/CollectionClone.js' \
'SM/Grant.js' \
'SM/Manage.js' \
'SM/CollectionPanel.js' \
'SM/MetaPanel.js' \
'LockingGridView.js' \
'SM/ColumnFilters.js' \
'SM/FindingsPanel.js' \
'SM/Acl.js' \
'SM/Attachments.js' \
'SM/Exports.js' \
'SM/Review.js' \
'SM/ReviewsImport.js' \
'SM/TransferAssets.js' \
'SM/Library.js' \
'SM/StigRevision.js' \
'SM/Inventory.js' \
'SM/AssetSelection.js' \
'SM/User.js' \
'SM/UserGroup.js' \
'SM/AppInfo.js' \
'SM/AppData.js' \
'library.js' \
'collectionAdmin.js' \
'collectionManager.js' \
'stigAdmin.js' \
'completionStatus.js' \
'findingsSummary.js' \
'review.js' \
'collectionReview.js' \
'ExportButton.js' \
'jszip.min.js' \
'FileSaver.js' \
'jsonview.bundle.js' \
'stigman.js' -o ../../$DistDir/js/stig-manager.min.js -m -c --source-map "root='src',url='stig-manager.min.js.map'"

echo "Copying files for sourcemap debugging"
cp -r . ../../$DistDir/js/src

echo "Client build finished"
