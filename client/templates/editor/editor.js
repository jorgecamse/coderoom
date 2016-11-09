var mode;

Template.editor.helpers({
  docid: function () {
    return Session.get('document');
  },
  configAce: function () {
    return function(ace) {
      ace.setTheme('ace/theme/monokai');
      ace.setShowPrintMargin(false);
      ace.getSession().setUseWrapMode(true);
      ace.$blockScrolling = Infinity;
    };
  },
  setConfig: function () {
    return function(ace) {
      if(mode === 'edit') {
        ace.setReadOnly(false);
        addListeners(ace);
      } else {
        ace.setReadOnly(true);
      }
      ace.setValue('');
      Session.set('loadingEditor', false);
    };
  }
});

Template.editor.created = function() {
  Session.set('loadingEditor', true);
  mode = this.data.mode;
};

function addListeners(editor) {
  // Editor Events
  editor.getSession().on('change', function(e) {
    if(Session.get('recording')) {
      var ev;

      switch (e.action) {
        case 'remove':
          ev = {
            type: 'editor',
            toDo: 'editor.getSession().getDocument().remove(arg);',
            arg: {start: e.start, end: e.end}
          };
          break;
        case 'insert':
          ev = {
            type: 'editor',
            toDo: 'editor.getSession().getDocument().insertMergedLines(arg.start, arg.lines)',
            arg: {start: e.start, lines: e.lines}
          };
          break;
        default:
          break;
      }

      Timeline.addEvent(ev);
    }
  });

  //selection events
  editor.getSession().selection.on('changeSelection', function() {
    if(Session.get('recording')) {
      var ev;
      var selection = editor.getSession().selection;

      if(!selection.isEmpty()) {
        ev = {
          type: 'editor',
          toDo: 'editor.getSession().selection.setSelectionRange(arg);',
          arg: selection.getRange()
        };
      } else {
        ev = {
          type: 'editor',
          toDo: 'editor.getSession().selection.clearSelection();'
        };
      }

      Timeline.addEvent(ev);
    }
  });

  //cursor events
  editor.getSession().selection.on('changeCursor', function() {
    if(Session.get('recording')) {
      Timeline.addEvent({
        type: 'editor',
        toDo: 'editor.getSession().selection.moveCursorToPosition(arg);',
        arg: editor.getSession().selection.getCursor()
      });
    }
  });
};
