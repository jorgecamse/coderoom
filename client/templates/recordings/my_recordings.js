Template.myRecordings.helpers({
  recordings: function() {
    return Recordings.find({ownerId: Meteor.userId(), state: 'finished'});
  },
  recordingsCount: function(){
    return Recordings.find({ownerId: Meteor.userId(), state: 'finished'}).count();
  }
});

Template.registerHelper('parseDuration', function (value) {
  var durationMinute = Math.floor(value / 60);
  var durationSecond = Math.floor(value - durationMinute * 60);
  durationSecond = (String(durationSecond).length > 1) ? durationSecond : (String('0') + durationSecond);
  return durationMinute + ':' + durationSecond;
});