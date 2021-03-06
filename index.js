const Sonos = require('sonos').Sonos
var urllibsync = require('urllib-sync');
var urlencode = require('urlencode');
var fs = require('fs');
var config = require('nconf');
var Entities = require('html-entities').AllHtmlEntities;

config.argv()
    .env()
    .file({ file: 'config.json' })
    .defaults({
        'adminChannel': 'music-admin',
        'standardChannel': 'music',
        'maxVolume': '75',
        'market': 'US',
        'blacklist': [],
        'searchLimit': 7,
        'myUserId': ''
    });

const myUserId = config.get('myUserId');
var adminChannel = config.get('adminChannel');
var standardChannel = config.get('standardChannel');
var channelSaved;
var token = config.get('token');
var maxVolume = config.get('maxVolume');
var market = config.get('market');
var blacklist = config.get('blacklist');
var apiKey = config.get('apiKey');
var searchLimit = config.get('searchLimit');
if (!Array.isArray(blacklist)) {
    blacklist = blacklist.replace(/\s*(,|^|$)\s*/g, "$1").split(/\s*,\s*/);
}

const sonos = new Sonos(config.get('sonos'));

var gongCounter = 0;
var gongLimit = 3;
var gongLimitPerUser = 1;
var gongScore = {};
var gongMessage = [
    "Is it really all that bad?",
    "Is it that distracting?",
    "How much is this worth to you?",
    "I agree. Who added this song anyway?",
    "Thanks! I didn't want to play this song in the first place...",
    "Hey, I only played this song because it's Matt's favourite.",
    "Wow, after all I've done for you. Fine.",
    "Really? You were singing that song at your desk for hours yesterday.",
    "Good call!",
    "Would some harp music be better?"
];

var voteCounter = 0;
var voteLimit = 3;
var voteLimitPerUser = 1;
var voteScore = {};
var gongBanned = false;

var gongTrack = ""; // What track was a GONG called on

const stateFile = "./savedstate.json";
var stateContents;
var globalState;
try {
    stateContents = fs.readFileSync(stateFile);
    globalState = JSON.parse(stateContents);
}
catch (err) {
    // WARNING: Failure to open the state file will clear the state.
    globalState = {};
}

const RtmClient = require('@slack/client').RtmClient;
const RTM_EVENTS = require('@slack/client').RTM_EVENTS;
const MemoryDataStore = require('@slack/client').MemoryDataStore;

let slack = new RtmClient(token, {
    logLevel: 'error',
    dataStore: new MemoryDataStore(),
    autoReconnect: true,
    autoMark: true
});

slack.on('open', function () {
    var channel, channels, group, groups, id, messages, unreads;
    channels = [standardChannel];
    groups = [];
    //   unreads = slack.getUnreadCount();
    channels = (function () {
        var _ref, _results;
        _ref = slack.channels;
        _results = [];
        for (id in _ref) {
            channel = _ref[id];
            if (channel.is_member) {
                _results.push("#" + channel.name);
            }
        }
        return _results;
    })();

    groups = (function () {
        var _ref, _results;
        _ref = slack.groups;
        _results = [];
        for (id in _ref) {
            group = _ref[id];
            if (group.is_open && !group.is_archived) {
                _results.push(group.name);
            }
        }
        return _results;
    })();

    //    _log("Welcome to Slack. You are @" + slack.self + " of " + slack.team);
    //    _log('You are in: ' + channels.join(', '));
    //    _log('As well as: ' + groups.join(', '));
    //    messages = unreads === 1 ? 'message' : 'messages';
    //   var channel = slack.getChannelByName(standardChannel);
    var message = ":notes: " + "Im back!!" + "\n";
    //_slackMessage(message, adminChannel);

    _log("Starting...");
    return

});

slack.on(RTM_EVENTS.MESSAGE, (message) => {
    let channel, channelError, channelName, errors, response, text, textError, ts, type, typeError, user, userName;

    channel = slack.dataStore.getChannelGroupOrDMById(message.channel);

    response = '';
    type = message.type, ts = message.ts, text = message.text;
    channelName = (channel != null ? channel.is_channel : void 0) ? '#' : '';
    channelName = channelName + (channel ? channel.name : 'UNKNOWN_CHANNEL');
    userName = "<@" + message.user + ">";
    _log("Received: " + type + " " + channelName + " " + userName + " " + ts + " \"" + text + "\"");

    if (type !== 'message' || (text == null) || (channel == null)) {
        typeError = type !== 'message' ? "unexpected type " + type + "." : null;
        textError = text == null ? 'text was undefined.' : null;
        channelError = channel == null ? 'channel was undefined.' : null;
        errors = [typeError, textError, channelError].filter(function (element) {
            return element !== null;
        }).join(' ');

        return _log("Could not respond. " + errors);
    }

    if (blacklist.indexOf(userName) !== -1) {
        _log('User ' + userName + ' is blacklisted');
        _slackMessage("Nice try " + userName + ", you're banned :)", channel.id)
        return false;
    }

    user = slack.dataStore.getUserById(message.user);
    let displayName = (user != null ? user.display_name : void 0) != null ? "@" + user.name : "UNKNOWN_USER";
    if ((message.user !== myUserId) &&
        ((message.user == "USLACKBOT") || (user && user.is_bot))) {
        // There is a special case where slackbot complains that it didn't unfurl an image
        // Let's ignore this
        if (text.search("Pssst! I didn") >= 0) {
            return;
        }

        if (text.search("no bots allowed") >= 0) {
            return;
        }

        _slackMessage("Sorry " + userName + ", no bots allowed!", channel.id);
        return;
    }

    var input = text.split(' ');
    var term = input[0].toLowerCase();
    var sudo = false;
    // Only allow sudo if user is in sudoers.
    if (term == 'sudo' && input.length > 1) {
        _log("isSudoer", userName);
        if (isSudoer(userName)) {
            _log("sudo = true for ", userName);
            sudo = true;
            input.shift();
            term = input[0].toLowerCase();
        }
        else {
            _log("not sudoer", userName);
            _slackMessage("Request denied, " + userName + "!", channel.id);
            return;
        }
    }

    var matched = true;
    _log('term', term);
    switch (term) {
        case 'add':
            _add(input, channel, userName);
            break;
        case 'search':
            _search(input, channel, userName);
            break;
        case 'current':
        case 'wtf':
            _currentTrack(channel);
            break;
        case 'dong':
        case ':gong:':
        case 'gong':
            _gong(channel, userName);
            break;
        case 'gongcheck':
            _gongcheck(channel, userName);
            break;
        case 'vote':
            _vote(channel, userName);
            break;
        case 'votecheck':
            _votecheck(channel, userName);
            break;
        case 'list':
        case 'ls':
        case 'playlist':
            _showQueue(channel);
            break;
        case 'sl':
            _sl(channel, userName);
            break;
        case 'volume':
            _getVolume(channel);
            break;
        case 'count(list)':
            _countQueue(channel);
            break;
        case 'status':
            _status(channel);
            break;
        case 'deny':
            _deny(input, channel, userName);
            break;
        case 'help':
            _help(input, channel);
            break;
        default:
            matched = false;
            break;
    }

    // Add admin commands to this list to issue a message when a regular
    // user tries to use an admin-only command.
    var adminCommands = [
        'next',
        'gongPlay',
        'stop',
        'flush',
        'play',
        'pause',
        'playpause',
        'resume',
        'previous',
        'setvolume',
        'blacklist',
        'addsudo',
        'delsudo',
        'lssudo'
    ];

    var isAdminChannel = channel.name === adminChannel;
    if (!matched && adminCommands.indexOf(term) >= 0) {
        if (!isAdminChannel && !sudo) {
            _slackMessage("Sorry " + userName + ", I'm afraid I can't do that...", channel.id);
            return;
        }

        matched = true;
        switch (term) {
            case 'next':
                _nextTrack(channel);
                break;
            case 'gongPlay':
                _gongPlay(input, channel);
                break;
            case 'stop':
                _stop(input, channel);
                break;
            case 'flush':
                _flush(input, channel);
                break;
            case 'play':
                _play(input, channel);
                break;
            case 'pause':
                _pause(input, channel);
                break;
            case 'playpause':
            case 'resume':
                _resume(input, channel);
                break;
            case 'previous':
                _previous(input, channel);
                break;
            case 'setvolume':
                _setVolume(input, channel, userName);
                break;
            case 'blacklist':
                _blacklist(input, channel);
                break;
            case 'ban':
                _banTrack(input, channel);
                break;
            case 'addsudo':
                // Cannot access this via sudo, otherwise sudoers could
                // add/delete other users.
                if (channel.name === adminChannel) {
                    _addsudoer(input, channel);
                }
                break;
            case 'delsudo':
                // Cannot access this via sudo, otherwise sudoers could
                // add/delete other users.
                if (channel.name === adminChannel) {
                    _delsudoer(input, channel);
                }
                break;
            case 'lssudo':
                // Cannot access this via sudo, otherwise the list of sudoers
                // could be exposed in the normal channel.
                if (channel.name === adminChannel) {
                    _listsudoers(channel);
                }
                break;
            default:
                matched = false;
                break;
        }
    }

});

slack.on('error', function (error) {
    return console.error("Error: " + error);
});

slack.login();

// Sonos event listeners. Looks like the node-sonos examples are broken.
// sonos.on('CurrentTrack', function (track) {
//     console.log('Track changed to %s by %s', track.title, track.artist);

//     if (isBanned(track.title) || isBanned(track.artist)) {
//         console.log("Track is banned. Skipping track...");
//         _nextTrack(getStandardChannel());
//         return;
//     }

//     slackMessageStandard("Now playing '" + track.title + "' by " + track.artist);
// });

// sonos.on('NextTrack', function (track) {
//     console.log('The next track will be %s by %s', track.title, track.artist)
// });

// sonos.on('Volume', function (volume) {
//     console.log('New Volume %d', volume);
// });

// sonos.on('Mute', function (isMuted) {
//     console.log('This speaker is %s.', isMuted ? 'muted' : 'unmuted');
// });

// sonos.on('PlayState', function (state) {
//     console.log('The state changed to %s.', state);
// });


function _slackMessage(message, id) {
    slack.sendMessage(message, id);
}

function getStandardChannel() {
    if (!channelSaved) {
        channelSaved = slack.getChannelByName(standardChannel);
    }

    return channelSaved;
}

function slackMessageStandard(message) {
    _slackMessage(message, getStandardChannel().id);
}

function getState(key, defaultValue) {
    if (globalState.hasOwnProperty(key)) {
        return globalState[key];
    }

    return defaultValue;
}

function setState(key, value) {
    globalState[key] = value;
    saveGlobalState();
}

function saveGlobalState() {
    fs.writeFileSync(stateFile, JSON.stringify(globalState), 'utf-8');
}

function _log(...args) {
    // for (let val of args) {
    //     console.log(val);
    // }
    console.log(...args);
}

function _getVolume(channel) {


    sonos.getVolume(function (err, vol) {
        _log(err, vol);
        _slackMessage('Volume is ' + vol + ' deadly dB _(ddB)_', channel.id);
    });
}

function _setVolume(input, channel, userName) {
    var vol = input[1];

    if (isNaN(vol)) {
        _slackMessage('Nope.', channel.id);
        return;
    } else {
        vol = Number(vol);
        _log(vol);
        if (vol > maxVolume) {
            _slackMessage("That's a bit extreme, " + userName + "... lower please.", channel.id);
        } else {
            sonos.setVolume(vol, function (err, data) {
                _getVolume(channel);
            });
        }
    }
}

function _getQueue() {
    var res = null;
    sonos.getQueue(function (err, result) {
        res = result;
    });
    return res;
}

function _countQueue(channel, cb) {
    sonos.getQueue(function (err, result) {
        if (err) {
            if (cb) {
                return (err, null);
            }
            _log(err);
            _slackMessage('Error getting queue length', channel.id);
        } else {
            if (cb) {
                return cb(null);
            }
            _slackMessage(result.total, channel.id);
        }
    });
}

function _showQueue(channel, cb) {
    sonos.getQueue(function (err, result) {
        if (err) {
            if (cb) {
                return (err, null);
            }
            _log(err)
            _slackMessage("Couldn't fetch the queue", channel.id);

        } else {
            if (cb) {
                return cb(null, result.items);
            }
            _currentTrack(channel, function (err, track) {
                var message = "Total tracks in queue: " + result.total + "\n"
                    + "====================="
                result.items.map(
                    function (item, i) {
                        index = i + 1; // Make it 1-indexed. Cheers Mina :)
                        message += "\n";
                        if (item['title'] === track.title) {
                            message += ":notes: " + "_#" + index + "_ *Title:* " + item['title'];
                            message += " *Artist:* " + item['artist'];
                        } else {
                            message += ">_#" + index + "_ *Title:* " + item['title'];
                            message += " *Artist:* " + item['artist'];
                        }
                    }
                )
                _slackMessage(message, channel.id);
            });
        }
    });
}

// Need to track what song has had a GONG called
// If the GONG was called on the previous song, reset

function _gong(channel, userName) {

    _log("_gong...");

    _currentTrackTitle(channel, function (err, track) {
        _log("_gong > track: " + track);

        // NOTE: The gongTrack is checked in _currentTrackTitle() so we
        // need to let that go through before checking if gong is banned.
        if (gongBanned) {
            _slackMessage("Sorry " + userName + ", the people have voted and this track cannot be gonged...", channel.id);
            return;
        }

        // Get message
        _log("gongMessage.length: " + gongMessage.length);
        var ran = Math.floor(Math.random() * gongMessage.length);
        var randomMessage = gongMessage[ran];
        _log("gongMessage: " + randomMessage);

        // Need a delay before calling the rest
        if (!(userName in gongScore)) {
            gongScore[userName] = 0
        }

        if (gongScore[userName] >= gongLimitPerUser) {
            _slackMessage("Are you trying to cheat, " + userName + "? DENIED!", channel.id);
        } else {
            if (userName in voteScore) {
                _slackMessage("Having regrets, " + userName + "? We're glad you came to your senses...", channel.id);
            }

            gongScore[userName] = gongScore[userName] + 1
            gongCounter++;
            _slackMessage(randomMessage + " This is GONG " + gongCounter + "/" + gongLimit + " for " + track, channel.id);
            if (gongCounter >= gongLimit) {
                _slackMessage("The music got GONGED!!", channel.id);
                _nextTrack(channel);
                gongCounter = 0;
                gongScore = {}
            }
        }
    });
}

function _vote(channel, userName) {
    _log("_vote...");
    _currentTrackTitle(channel, function (err, track) {
        _log("_vote > track: " + track);

        if (!(userName in voteScore)) {
            voteScore[userName] = 0
        }

        if (voteScore[userName] >= voteLimitPerUser) {
            _slackMessage("Are you trying to cheat, " + userName + "? DENIED!", channel.id)
        } else {
            if (userName in gongScore) {
                _slackMessage("Changed your mind, " + userName + "? Well, ok then...", channel.id);
            }

            voteScore[userName] = voteScore[userName] + 1
            voteCounter++;
            _slackMessage("This is VOTE " + voteCounter + "/" + voteLimit + " for " + track, channel.id);
            if (voteCounter >= voteLimit) {
                _slackMessage("This track is now immune to GONG! (just this once)", channel.id);
                voteCounter = 0;
                voteScore = {}
                gongBanned = true;
            }
        }
    });
}

function _deny(input, channel, userName) {
    if (input[1] == 'this') {
        _currentTrackTitle(channel, function (err, track) {
            denyTrack(track, channel, userName);
        });
        return;
    }

    var data = _searchSpotify(input, channel, userName, 1);
    if (!data) {
        return;
    }

    var spid = data.tracks.items[0].id;
    var uri = data.tracks.items[0].uri;
    var external_url = data.tracks.items[0].external_urls.spotify;

    var albumImg = data.tracks.items[0].album.images[2].url;
    var trackName = data.tracks.items[0].artists[0].name + ' - ' + data.tracks.items[0].name;

    denyTrack(trackName, channel, userName);
}

function denyTrack(trackName, channel, userName) {
    var denyList = getState('denyList', {});
    if (!denyList.hasOwnProperty(trackName)) {
        denyList[trackName] = [];
    }

    var found = false;
    for (var i = 0; i < denyList[trackName].length; i++) {
        if (denyList[trackName][i] === userName) {
            found = true;
            break;
        }
    }

    if (found) {
        _slackMessage("Sorry " + userName + ", you've already denied this track!", channel.id);
    }
    else {
        denyList[trackName].push(userName);
        setState('denyList', denyList);

        var numVotes = denyList[trackName].length;
        _slackMessage("Noted, " + userName + ". That track now has " + numVotes + " deny votes.", channel.id);
    }
}

function isDenied(trackName) {
    var denyList = getState('denyList', {});
    if (!denyList.hasOwnProperty(trackName)) {
        return false;
    }

    if (denyList[trackName].length < 3) {
        return false;
    }

    return true;
}

function _banTrack(input, channel) {
    var trackName = input.splice(1).join(" ").toLowerCase();
    var banList = getState('banTrackList', []);
    if (!banList.includes(trackName)) {
        banList.push(trackName);
        setState('banTrackList', banList);
        _slackMessage("Added '" + trackName + "' to the list of banned tracks", channel.id);
    }
    else {
        _slackMessage("'" + trackName + "' is already banned", channel.id);
    }
}

// A track is considered banned if it contains any of the substrings in the banList.
function isBanned(trackName) {
    var track = trackName.toLowerCase();
    var banList = getState('banTrackList', []);
    for (let s of banList) {
        if (track.includes(s)) {
            return true;
        }
    }
    return false;
}

function _addsudoer(input, channel) {
    var name = fixName(input[1]);
    if (!isSudoer(name)) {
        var sudoers = getState('sudoers', []);
        sudoers.push(name);
        setState('sudoers', sudoers);
        _slackMessage("Added " + name + " to sudoers list", channel.id);
    }
    else {
        _slackMessage(name + " is already a sudoer", channel.id);
    }
}

function _delsudoer(input, channel) {
    var name = fixName(input[1]);

    if (isSudoer(name)) {
        var sudoers = getState('sudoers', []);
        var newSudoers = [];
        for (var i = 0; i < sudoers.length; i++) {
            if (sudoers[i] != name) {
                newSudoers.push(sudoers[i])
            }
        }

        setState('sudoers', newSudoers);
        _slackMessage("Removed " + name + " from sudoers list", channel.id);
    }
    else {
        _slackMessage(name + " is not a sudoer", channel.id);
    }
}

function _listsudoers(channel) {
    var sudoers = getState('sudoers', []);
    var sudoersText = "Current list of sudoers:\n" + sudoers.join("\n");
    _slackMessage(sudoersText, channel.id);
}

function fixName(name) {
    if (name.charAt(0) != '<') {
        name = "<" + name + ">";
    }
    return name;
}

function isSudoer(userName) {
    var name = fixName(userName);
    var sudoers = getState('sudoers', []);
    return sudoers.indexOf(name) >= 0;
}

function _gongcheck(channel, userName) {
    _log("_gongcheck...");

    _currentTrackTitle(channel, function (err, track) {
        _log("_gongcheck > track: " + track);

        _slackMessage("GONG is currently " + gongCounter + "/" + gongLimit + " for " + track, channel.id);
        var gongers = Object.keys(gongScore);
        if (gongers.length > 0) {
            _slackMessage("Gonged by " + gongers.join(','), channel.id);
        }
    });
}

function _votecheck(channel, userName) {
    _log("_votecheck...");

    _currentTrackTitle(channel, function (err, track) {
        _log("_votecheck > track: " + track);

        _slackMessage("VOTE is currently " + voteCounter + "/" + voteLimit + " for " + track, channel.id);
        var voters = Object.keys(voteScore);
        if (voters.length > 0) {
            _slackMessage("Voted by " + voters.join(','), channel.id);
        }
    });
}

function _previous(input, channel) {
    sonos.previous(function (err, previous) {
        _log(err, previous);
    });
}

function _help(input, channel) {
    var message = 'Current commands!\n' +
        '=====================\n' +
        '`current` : List current track\n' +
        '`status` : Show current status of Sonos\n' +
        '`search` _text_ : Search for a track, does NOT add it to the queue\n' +
        '`add` _text_ : Add song to the queue and start playing if idle.\n' +
        '`gong` : The current track is bad! ' + gongLimit + ' gongs will skip the track\n' +
        '`gongcheck` : How many gong votes there are currently, as well as who has gonged.\n' +
        '`vote` : The current track is great! ' + voteLimit + ' votes will prevent the track from being gonged\n' +
        '`volume` : View current volume\n' +
        '`list` : List current queue\n' +
        '`deny` _text_ : Prevent the song from being added again\n' +
        '`sl` : Try it and see\n' +
        '`help` : What you just typed\n';

    if (channel.name == adminChannel) {
        message += '------ ADMIN FUNCTIONS ------\n' +
            '`flush` : Flush the current queue\n' +
            '`setvolume` _number_ : Sets volume\n' +
            '`play` : Play track\n' +
            '`stop` : Stop life\n' +
            '`pause` : Pause life\n' +
            '`resume` : Resume after pause\n' +
            '`next` : Play next track\n' +
            '`previous` : Play previous track\n' +
            '`blacklist` : Show users on blacklist\n' +
            '`blacklist add @username` : Add `@username` to the blacklist\n' +
            '`blacklist del @username` : Remove `@username` from the blacklist\n';
    }
    message += '=====================\n'
    _slackMessage(message, channel.id);
}

function _play(input, channel) {
    sonos.selectQueue(function (err, result) {
        sonos.play(function (err, playing) {
            _log([err, playing])
            if (playing) {
                _slackMessage("Sonos is already PLAYING.", channel.id);
            }
            else {
                _slackMessage("Sonos is now PLAYING.", channel.id);
            }
        });
    });
}

function _stop(input, channel) {
    sonos.stop(function (err, stopped) {
        _log([err, stopped])
        if (stopped) {
            _slackMessage("Sonos is now STOPPED.", channel.id);
        }
    });
}

function _pause(input, channel) {
    sonos.selectQueue(function (err, result) {
        sonos.pause(function (err, paused) {
            _log([err, paused])
            _slackMessage("Sonos is now PAUSED.", channel.id);
        });
    });
}

function _resume(input, channel) {
    sonos.play(function (err, playing) {
        _log([err, playing])
        if (playing) {
            _slackMessage("Resuming...", channel.id);
        }
    });
}

function _flush(input, channel) {
    sonos.flush(function (err, flushed) {
        _log([err, flushed])
        if (flushed) {
            _slackMessage("Sonos queue is clear.", channel.id);
        }
    });
}


function _gongPlay(channel) {
    sonos.play('http://raw.githubusercontent.com/htilly/zenmusic/master/doc/sound/gong.mp3', function (err, playing) {
        _log([err, playing])
    });
}


function _nextTrack(channel) {
    sonos.next(function (err, nexted) {
        if (err) {
            _log(err);
        } else {
            _slackMessage('Playing the next track...', channel.id);
        }
    });
}

function _currentTrack(channel, cb) {
    sonos.currentTrack(function (err, track) {
        if (err) {
            _log(err);
            if (cb) {
                return cb(err, null);
            }
        } else {
            if (cb) {
                return cb(null, track);
            }
            _log(track);
            var fmin = '' + Math.floor(track.duration / 60);
            fmin = fmin.length == 2 ? fmin : '0' + fmin;
            var fsec = '' + track.duration % 60;
            fsec = fsec.length == 2 ? fsec : '0' + fsec;

            var pmin = '' + Math.floor(track.position / 60);
            pmin = pmin.length == 2 ? pmin : '0' + pmin;
            var psec = '' + track.position % 60;
            psec = psec.length == 2 ? psec : '0' + psec;


            var message = `We're rocking out to *${track.artist}* - *${track.title}* (${pmin}:${psec}/${fmin}:${fsec})`;
            _slackMessage(message, channel.id);
        }
    });
}

function _currentTrackTitle(channel, cb) {
    sonos.currentTrack(function (err, track) {
        var _track = "";
        if (err) {
            _log(err);
        } else {
            _track = track.title;
            _log("_currentTrackTitle > title: " + _track);
            _log("_currentTrackTitle > gongTrack: " + gongTrack);

            if (gongTrack !== "") {
                if (gongTrack !== _track) {
                    _log("_currentTrackTitle > different track, reset!");
                    gongCounter = 0;
                    gongScore = {};
                    gongBanned = false;
                    voteCounter = 0;
                    voteScore = {};
                } else {
                    _log("_currentTrackTitle > gongTrack is equal to _track");
                }
            } else {
                _log("_currentTrackTitle > gongTrack is empty");
            }

            gongTrack = _track;
        }

        cb(err, _track);
    });
}

function _add(input, channel, userName) {
    var data = _searchSpotify(input, channel, userName, 1);
    if (!data) {
        return;
    }

    var spid = data.tracks.items[0].id;
    var uri = data.tracks.items[0].uri;
    var external_url = data.tracks.items[0].external_urls.spotify;

    var albumImg = data.tracks.items[0].album.images[2].url;
    var trackName = data.tracks.items[0].artists[0].name + ' - ' + data.tracks.items[0].name;

    if (isDenied(trackName)) {
        _slackMessage("Sorry " + userName + ", your request has been denied.", channel.id);
        return;
    }

    sonos.getCurrentState(function (err, state) {
        if (err) {
            _log(err);
        } else {
            if (state === 'stopped') {
                _addToSpotify(userName, spid, albumImg, trackName, channel, function () {
                    // Start playing the queue automatically.
                    _play('play', channel);
                });

            } else if (state === 'playing') {
                //Add the track to playlist...
                _addToSpotify(userName, spid, albumImg, trackName, channel);
            } else if (state === 'paused') {
                _addToSpotify(userName, spid, albumImg, trackName, channel, function () {
                    if (channel.name === adminChannel) {
                        _slackMessage("Sonos is currently PAUSED. Type `resume` to start playing...", channel.id);
                    }
                });

            } else if (state === 'transitioning') {
                _slackMessage("Sonos says it is 'transitioning'. We've got no idea what that means either...", channel.id);
            } else if (state === 'no_media') {
                _slackMessage("Sonos reports 'no media'. Any idea what that means?", channel.id);
            } else {
                _slackMessage("Sonos reports its state as '" + state + "'. Any idea what that means? I've got nothing.", channel.id);
            }
        }
    });
}

function _search(input, channel, userName) {
    var data = _searchSpotify(input, channel, userName, searchLimit);
    if (!data) {
        return;
    }

    var trackNames = [];
    for (var i = 1; i <= data.tracks.items.length; i++) {

        var spid = data.tracks.items[i - 1].id;
        var uri = data.tracks.items[i - 1].uri;
        var external_url = data.tracks.items[i - 1].external_urls.spotify;

        var albumImg = data.tracks.items[i - 1].album.images[2].url;
        var trackName = data.tracks.items[i - 1].artists[0].name + ' - ' + data.tracks.items[i - 1].name;

        trackNames.push(trackName);
    }

    //Print the result...
    var message = userName
        + ', I found the following track(s):\n```\n'
        + trackNames.join('\n')
        + '\n```\nIf you want to play it, use the `add` command..\n';

    _slackMessage(message, channel.id)
}

function _addToSpotify(userName, spid, albumImg, trackName, channel, cb) {
    sonos.addSpotify(spid, function (err, res) {
        var message = '';
        if (!res) {
            message = 'Error! No spotify account?';
            _log(err);
            return;
        }

        var queueLength = res[0].FirstTrackNumberEnqueued;
        _log('queueLength', queueLength);
        message = 'Sure '
            + userName
            + ', Added "'
            + trackName
            + '" to the queue!\n'
            + albumImg
            + '\nPosition in queue is '
            + queueLength;

        _slackMessage(message, channel.id)

        if (cb) {
            cb();
        }
    });
}

function _searchSpotify(input, channel, userName, limit) {
    let accessToken = _getAccessToken(channel.id);
    if (!accessToken) {
        return false;
    }

    var query = '';
    for (var i = 1; i < input.length; i++) {
        query += urlencode(input[i]);
        if (i < input.length - 1) {
            query += ' ';
        }
    }

    var getapi = urllibsync.request(
        'https://api.spotify.com/v1/search?q='
        + query
        + '&type=track&limit='
        + limit
        + '&market='
        + market
        + '&access_token='
        + accessToken
    );

    var data = JSON.parse(getapi.data.toString());
    _log(data);
    if (!data.tracks || !data.tracks.items || data.tracks.items.length == 0) {
        _slackMessage('Sorry ' + userName + ', I could not find that track :(', channel.id);
        return;
    }

    return data;
}

function _status(channel) {
    sonos.getCurrentState(function (err, state) {
        if (err) {
            _log(err);
            return;
        }

        _slackMessage("Sonos state is '" + state + "'", channel.id);
    });
}

function _sl(channel, userName) {
    var train = "      oooOOOOOOOOOOO\"\n"
        + "     o   ____          :::::::::::::::::: :::::::::::::::::: __|-----|__\n"
        + "     Y_,_|[]| --++++++ |[][][][][][][][]| |[][][][][][][][]| |  [] []  |\n"
        + "    {|_|_|__|;|______|;|________________|;|________________|;|_________|;\n"
        + "     /oo--OO   oo  oo   oo oo      oo oo   oo oo      oo oo   oo     oo\n"
        + "+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+";
    _slackMessage("Just for you, " + userName + "\n```\n" + train + "\n```\n", channel.id);
}

function _blacklist(input, channel) {
    var action = ((input[1]) ? input[1] : '');
    var slackUser = ((input[2]) ? slack.dataStore.getUserById(input[2].slice(2, -1)) : '');

    if (input[2] != '' && typeof slackUser !== 'undefined') {
        var username = '@' + slackUser.name;
    } else if (input[2] != '') {
        message = 'The user ' + (input[2]) + ' is not a valid Slack user.';
    }

    if (action == '') {
        message = 'The following users are blacklisted:\n```\n' + blacklist.join('\n') + '\n```';

    } else if (typeof username !== 'undefined') {

        if (action == 'add') {
            var i = blacklist.indexOf(username);
            if (i == -1) {
                blacklist.push(username);
                message = 'The user ' + username + ' has been added to the blacklist.';
            } else {
                message = 'The user ' + username + ' is already on the blacklist.';
            }

        } else if (action == 'del') {
            var i = blacklist.indexOf(username);
            if (i != -1) {
                blacklist.splice(i, 1);
                message = 'The user ' + username + ' has been removed from the blacklist.';
            } else {
                message = 'The user ' + username + ' is not on the blacklist.';
            }

        } else {
            message = 'Usage: `blacklist add|del @username`';
        }
    }
    _slackMessage(message, channel.id)
}

function _getAccessToken(channelid) {
    if (apiKey === '') {
        _slackMessage('You did not set up an API key. Naughty.', channelid);
        return false;
    }

    let getToken = urllibsync.request('https://accounts.spotify.com/api/token', {
        method: "POST",
        data: { 'grant_type': 'client_credentials' },
        headers: { 'Authorization': 'Basic ' + apiKey }
    });
    let tokendata = JSON.parse(getToken.data.toString());
    return tokendata.access_token;
}

// Playing with Travis.
// Just something that will return a value

module.exports = function (number, locale) {
    return number.toLocaleString(locale);
};
