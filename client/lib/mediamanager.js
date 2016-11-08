var remoteMediaEvId;

MediaManager = (function () {

  var module = {};

  var webrtc = null;
  var localStream;

  var mediaRecorder,
     recordedBlobs;

  function generateBlob(name) {
    var blob = new Blob(recordedBlobs, {
      type: 'video/webm'
    });
    blob.name = name;

    return blob;
  };

  function handleDataAvailable(event) {
    if (event.data && event.data.size > 0) {
      recordedBlobs.push(event.data);
    };
  };

  function updateRecording(response) {
    var fileId = JSON.parse(response).id;
    var recordingId = RoomManager.getRoomRecording().id;

    var r = Recordings.findOne({_id: recordingId});

    if (r) {
      var sourceRecording = {
        id: Session.get('myMediaEventId'),
        file: fileId
      };
      r.sources.push(sourceRecording);

      if(Session.get('isModerator')) {
        var events = Timeline.getEvents();

        r.events = events;
        r.duration = events[events.length-1].timestamp;
        r.state = 'finished';
      };

      // Update recording
      Recordings.update({_id: recordingId}, r);
    }

    var googleService = Meteor.user().services.google;
    var participants = ParticipantsManager.getParticipants();
    Object.keys(participants).forEach(function(key, i) {
      if(participants[key].profile.email !== googleService.email) {
        var permissionsConfig = {
          fileId: fileId,
          token: googleService.accessToken,
          body: {
            value: participants[key].profile.email,
            type: 'user',
            role: 'reader'
          }
        };
        setTimeout(function() {
          UploaderManager.insertPermissions(permissionsConfig);
        }, i * 2000);
      }
    });

    Session.set('uploading', false);
  }

  function handleStop() {
    var blob = generateBlob(RoomManager.getRoomRecording().title);

    if (blob.size > 0) {
      var data = {
        file: blob,
        token: Meteor.user().services.google.accessToken,
        onComplete: updateRecording
      };

      UploaderManager.upload(data);
      Session.set('uploading', true);
    };
  };

  function onError(event) {
    throwAlert('error', 'Recorder error: ' + event, 'alert-circle');
  };

  function setMyRoom(config) {
    // unmute media and set editor write
    webrtc.unmute();
    ace.edit('editor').setReadOnly(false);
    Session.set('live', true);

    record(config.data);
  };

  function record(data) {
    if(data.recording.active) {
      Session.set('myMediaEventId', data.eventId);
      RoomManager.setRoomRecording(data.recording.info);
      Session.set('recording', true);
      Session.set('stopping', false);
    }
  };

  function unSetMyRoom() {
    // Mute media and set editor read only
    webrtc.mute();
    ace.edit('editor').setReadOnly(true);
    Session.set('live', false);

    if(Session.get('recording')) {
      Session.set('recording', false);
      Session.set('stopping', true);
    }
  };

  function isMessageForMe(id) {
    var sParticipant = ParticipantsManager.getSecondaryParticipant();
    return localStream.id === id && sParticipant != null;
  };

  function addMediaListeners() {
    webrtc.on('readyToCall', function () {
      var room = this.config.room;

      if (room) {
        webrtc.joinRoom(room);
      }
    });

    webrtc.on('localStream', function (stream) {
      // if moderator pause video until start session
      if(Session.get('isModerator')){
        this.pauseVideo();
      }

      // Mute all streams
      this.mute();

      RoomManager.setLocalStream(stream);
      localStream = stream;

      var conf = {
        stream: stream,
        profile: this.config.nick
      };
      ParticipantsManager.addLocalParticipant(conf);

      Session.set('loadingMedia', false);
    });

    webrtc.on('videoAdded', function (video, peer) {
      var conf = {
        stream: peer.stream,
        profile: peer.nick
      };
      ParticipantsManager.addParticipant(conf);
    });

    webrtc.on('videoRemoved', function (video, peer) {
      ParticipantsManager.removeParticipantByStream(peer.stream);
      var lastSParticipant = ParticipantsManager.getSecondaryParticipant();
      if (lastSParticipant) {
        if(Session.get('isModerator') && Session.get('recording') && lastSParticipant.stream.id === peer.stream.id) {
          Timeline.addEvent({
            id: remoteMediaEvId,
            type: 'media',
            toDo: 'remove',
            arg: lastSParticipant.stream.id
          });
        }
        ParticipantsManager.updateSecondaryParticipant(lastSParticipant);
      }
    });

    webrtc.connection.on('message', function(message){
      switch(message.type) {
        case 'muteMedia':
          unSetMyRoom();
          break;
        case 'setSecondaryParticipant':
          var participantId = message.payload.to;
          var searchedParticipant = ParticipantsManager.getParticipantById(participantId);
          ParticipantsManager.updateSecondaryParticipant(searchedParticipant);

          if(isMessageForMe(participantId)) {
            setMyRoom(message.payload);
          };
          break;
        case 'recording':
          if(isMessageForMe(message.payload.to)) {
            record(message.payload.data);
          };
          break;
        case 'recordingStop':
          if(isMessageForMe(message.payload.to)) {
            Session.set('recording', false);
            Session.set('stopping', true);
          };
          break;
        case 'setEditorMode':
          setModeEditor(message.payload);
          break;
        case 'textMessage':
          module.addMessage(message.payload, true);
          break;
        case 'finishedSession':
          $('#finishedBroadcast.modal').modal('show');
          break;
        default:
          break;
      }
    });
  };

  module.connect = function(options) {
    // create webrtc connection
    webrtc = new SimpleWebRTC(options);
    addMediaListeners();
    return webrtc;
  };

  module.resumeMedia = function() {
    webrtc.resume();
    Session.set('live', true);
  };

  module.pauseMedia = function() {
    webrtc.pause();
  };

  module.updateSecondaryParticipant = function(participantId) {
    var lastSParticipant = ParticipantsManager.getSecondaryParticipant();
    if(Session.get('recording') && lastSParticipant) {
      Timeline.addEvent({
        id: remoteMediaEvId,
        type: 'media',
        toDo: 'remove',
        arg: lastSParticipant.stream.id
      });
    }

    // Send message to mute previous secondary participant
    this.sendToAllMessage('muteMedia');

    // Send message to set a new secondary participant
    remoteMediaEvId = Timeline.generateEventId();
    var msg = {
      'to': participantId,
      'data': {
        eventId: remoteMediaEvId,
        recording: {
          active: Session.get('recording'),
          info: RoomManager.getRoomRecording()
        }
      }
    };
    MediaManager.sendToAllMessage('setSecondaryParticipant', msg);

    var searchedParticipant = ParticipantsManager.getParticipantById(participantId);
    ParticipantsManager.updateSecondaryParticipant(searchedParticipant);

    // If new secondary participant fire event insert.
    var currentSParticipant = ParticipantsManager.getSecondaryParticipant();
    if(Session.get('recording') && currentSParticipant) {
      Timeline.addEvent({
        id: remoteMediaEvId,
        type: 'media',
        toDo: 'insert',
        arg: currentSParticipant.stream.id
      });
    }
  };

  module.sendToAllMessage = function(type, msg) {
    webrtc.sendToAll(type, msg);
  };

  module.addMessage = function(msg, remote) {
    var origin = remote ? '' : 'chat__message--right';
    var p = '<div class="chat__message '+origin+'">';
    p += '<div class="chat__message__name">'+msg.name+'</div>';
    p += '<div class="chat__message__content">';
    p += '<div class="chat__message__img">'+'<img src="'+msg.image+'">'+'</div>';
    p += '<div class="chat__message__msg">'+'<div class="chat__message__body">'+msg.value+'</div>'+'</div>';
    p += '</div>';
    p += '</div>';

    $('.chat__container .chat__messages').append(p);

    var scrollValue = $('.chat__container .chat__messages')[0].scrollHeight;
    $('.chat__container').scrollTop(scrollValue);

    if(Session.get('isModerator') && Session.get('recording')) {
      msg.remote = remote;
      Timeline.addEvent({
        type: 'chat',
        toDo: 'insert',
        arg: msg
      });
    }
  };

  module.sendTextMessage = function(value) {
    var msg =  {
      name: webrtc.config.nick.name,
      image: webrtc.config.nick.image,
      value: value
    };

    this.addMessage(msg);
    this.sendToAllMessage('textMessage', msg);
  };

  module.startRecord = function() {
    var options = {mimeType: 'video/webm', bitsPerSecond: 100000};

    recordedBlobs = [];
    try {
      mediaRecorder = new MediaRecorder(localStream, options);
    } catch (e0) {
      console.log('Unable to create MediaRecorder with options Object: ', e0);
      try {
        options = {mimeType: 'video/webm,codecs=vp9', bitsPerSecond: 100000};
        mediaRecorder = new MediaRecorder(localStream, options);
      } catch (e1) {
        console.log('Unable to create MediaRecorder with options Object: ', e1);
        try {
          // Chrome 47
          options = 'video/vp8';
          mediaRecorder = new MediaRecorder(localStream, options);
        } catch (e2) {
          alert('MediaRecorder is not supported by this browser.\n\n' +
              'Try Firefox 29 or later, or Chrome 47 or later, with Enable experimental Web Platform features enabled from chrome://flags.');
          console.error('Exception while creating MediaRecorder:', e2);
          return;
        }
      }
    }
    console.log('Created MediaRecorder', mediaRecorder, 'with options', options);

    mediaRecorder.onstop = handleStop;
    mediaRecorder.ondataavailable = handleDataAvailable;
    mediaRecorder.onerror = onError;
    // Collect 10ms of data
    mediaRecorder.start(10);
  };

  module.stopRecord = function() {
    if(mediaRecorder) {
      mediaRecorder.stop();
    }
  };

  return module;

}());

Tracker.autorun(function() {
  if(Session.get('recording')) {
    // Create timeline
    Timeline.init({mediaEl: document.getElementById('main-media')});

    MediaManager.startRecord();

    // insert first event
    if(Session.get('isModerator')) {
      throwAlert('info', 'Session is being recorded');

      var evId = Timeline.generateEventId();
      Session.set('myMediaEventId', evId);

      Timeline.addEvent({
        id: evId,
        type: 'media',
        toDo: 'insert',
        arg: RoomManager.getLocalStream().id
      });

      var lastSParticipant = ParticipantsManager.getSecondaryParticipant();
      if (lastSParticipant) {
        remoteMediaEvId = Timeline.generateEventId();
        var msg = {
          'to': lastSParticipant.stream.id,
          'data': {
            eventId: remoteMediaEvId,
            recording: {
              active: Session.get('recording'),
              info: RoomManager.getRoomRecording()
            }
          }
        };
        MediaManager.sendToAllMessage('recording', msg);

        Timeline.addEvent({
          id: remoteMediaEvId,
          type: 'media',
          toDo: 'insert',
          arg: lastSParticipant.stream.id
        });
      }
    };
  };
});

Tracker.autorun(function() {
  if(Session.get('stopping')) {
    MediaManager.stopRecord();

    if(Session.get('isModerator')) {
      throwAlert('info', 'Recording has stopped', 'information');

      var lastSParticipant = ParticipantsManager.getSecondaryParticipant();
      if (lastSParticipant) {
        var msg = {
          'to': lastSParticipant.stream.id
        };
        MediaManager.sendToAllMessage('recordingStop', msg);

        Timeline.addEvent({
          id: remoteMediaEvId,
          type: 'media',
          toDo: 'remove',
          arg: lastSParticipant.stream.id
        });
      }

      // insert last event
      Timeline.addEvent({
        id: Session.get('myMediaEventId'),
        type: 'media',
        toDo: 'remove',
        arg: RoomManager.getLocalStream().id
      });

      Session.set('stopping', false);
    }
  }
});
