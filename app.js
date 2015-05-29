var port = (process.env.VCAP_APP_PORT || 3000);
var express = require("express");
var mongoClient = require("mongodb").MongoClient;
var mqlight = require('mqlight');
var sentiment = require('sentiment');

var os = require("os-utils");
var usage = require("usage"),

var vcapApplication = JSON.parse(process.env.VCAP_APPLICATION);
var applicationId = vcapApplication.application_name;


// Settings
var dbKeywordsCollection	= "keywords";
var dbResultsCollection		= "results";
var dbCacheCollection		= "cache";
var dbServerUsageCollection = "serverusage";


var mqlightTweetsTopic = "mqlight/ase/tweets";
var mqlightAnalyzedTopic = "mqlight/ase/analyzed";
var mqlightAggregateTopic = "mqlight/ase/aggregate";

var mqlightShareID = "ase-analyzer";
var mqlightServiceName = "mqlight";
var mqlightSubInitialised = false;
var mqlightClient = null;

// Set constant variables
var ZERO = 0,
    ONE_TENTH = .1,
    ONE = 1,
    ONE_HUNDRED = 100,
    FIVE_THOUSAND = 5000,
    ONE_MILLION = 1E6;


/*
 * Establish MQ credentials
 */
var opts = {};
var mqlightService = {};
if (process.env.VCAP_SERVICES) {
  var services = JSON.parse(process.env.VCAP_SERVICES);
  console.log( 'Running BlueMix');
  if (services[ mqlightServiceName ] == null) {
    throw 'Error - Check that app is bound to service';
  }
  mqlightService = services[mqlightServiceName][0];
  opts.service = mqlightService.credentials.connectionLookupURI;
  opts.user = mqlightService.credentials.username;
  opts.password = mqlightService.credentials.password;
} else {
  opts.service = 'amqp://localhost:5672';
}


// defensiveness against errors parsing request bodies...
process.on('uncaughtException', function (err) {
	console.log('Caught exception: ' + err.stack);
});

var app = express();
// Configure the app web container
app.configure(function() {
	app.use(express.bodyParser());
	app.use(express.static(__dirname + '/public'));
});



// Database Connection
var mongo = {};
var keywordsCollection = null;
var cacheCollection = null;
var resultsCollection = null;

if (process.env.VCAP_SERVICES) {
    var env = JSON.parse(process.env.VCAP_SERVICES);

    if (env['mongodb-2.4']) {
        mongo['url'] = env['mongodb-2.4'][0]['credentials']['url'];
    }

    console.log("Mongo URL:" + mongo.url);
} else {
   console.log("No VCAP Services!");
   mongo['url'] = "mongodb://localhost:27017/ase";
} 

var myDb; 
var mongoConnection = mongoClient.connect(mongo.url, function(err, db) {
    
   if(!err) {
    console.log("Connection to mongoDB established");
    myDb = db;

	keywordsCollection = myDb.collection(dbKeywordsCollection);
	resultsCollection = myDb.collection(dbResultsCollection);
	cacheCollection = myDb.collection(dbCacheCollection);

	// Start the App after DB Connection
	startApp();

  } else {
  	console.log("Failed to connect to database!");
  }
}); 


function startApp() {
	/*
	 * Create our MQ Light client
	 * If we are not running in Bluemix, then default to a local MQ Light connection  
	 */
	 
	runGC();
	runUsageMonitoring();
	 
	mqlightClient = mqlight.createClient(opts, function(err) {
	    if (err) {
	      console.error('Connection to ' + opts.service + ' using client-id ' + mqlightClient.id + ' failed: ' + err);
	    }
	    else {
	      console.log('Connected to ' + opts.service + ' using client-id ' + mqlightClient.id);
	    }
	    /*
	     * Create our subscription
	     */
	    mqlightClient.on('message', processMessage);
	    mqlightClient.subscribe(mqlightTweetsTopic, mqlightShareID, 
	        {credit : 5,
	           autoConfirm : true,
	           qos : 0}, function(err) {
	             if (err) console.error("Failed to subscribe: " + err); 
	             else {
	               console.log("Subscribed");
	               mqlightSubInitialised = true;
	             }
	           });
	  });
}


/*
 * Handle each message as it arrives
 */
function processMessage(data, delivery) {
	  var tweet = data.tweet;
	  try {
	    // Convert JSON into an Object we can work with 
	    data = JSON.parse(data);
	    tweet = data.tweet;
	  } catch (e) {
	    // Expected if we already have a Javascript object
	  }
	  if (!tweet) {
	    console.error("Bad data received: " + data);
	  }
	  else {
	    //console.log("Received data: " + JSON.stringify(data));
	    // Upper case it and publish a notification
	    
	    sentiment(tweet.text, function (err, results) {
			var result = {
				phrase: tweet.phrase,
				text: tweet.text,
				date: tweet.date,
				sentiment: results.score
			};
			resultsCollection.insert(result);

			var analyzed = {
				phrase: tweet.phrase,
				date: tweet.date
			};

			var msgData = {
		      "analyzed" : analyzed,
		      "frontend" : "Node.js: " + mqlightClient.id
		    };
		    //console.log("Sending message: " + JSON.stringify(msgData));
		    mqlightClient.send(mqlightAnalyzedTopic, msgData, {
			    ttl: 60*60*1000 /* 1 hour */
			    });
		});

	  }
}

//Creates the usage monitoring item for the first time in the DB
// later it will be updated only
// function startUsageMonitoring(){
// 	var usageCollection = myDb.collection(dbServerUsageCollection);
	
// 	os.cpuUsage(function(v){
// 		var usage = {
// 			appName: "analyzing",
// 			appId: applicationId,
// 			memUsed:	(os.totalmem() - os.freemem()),
// 			memTotal:	os.totalmem(),
// 			cpuLoad:	v
// 		}
		
// 		usageCollection.insert(usage);
// 	});
// }

function updateUsageInfo(){
	/*
		Gets current CPU/memory etc. usage and update corresponding entry in DB.
		Is called repeatedly.
	*/
	
	var usageCollection = myDb.collection(dbServerUsageCollection);
	
	os.cpuUsage(function(v){
		var query = {appName: "analyzing",
			appId: applicationId}
		var newValues = {
			$set: {
			memUsed:	(os.totalmem() - os.freemem()),
			memTotal:	os.totalmem(),
			cpuLoad:	v}
		}
		usageCollection.update(query, newValues, {upsert: true});
		// usageCollection.update(query, newValues);
	});
}

// Gets the CPU usage and emits an event with the utilization percentage
function getUsage()
{
    var pid = process.pid;
    var options = { keepHistory: true };

    // Looks up CPU usage data and compares it against last retrieved value
    usage.lookup(pid, options, function(err, result) {
        var newAvgCpuUsage = Math.round(result.cpu);
        // If average CPU usage has changed, emit a cpuChange event
        if (newAvgCpuUsage > ONE_HUNDRED)
            newAvgCpuUsage = ONE_HUNDRED;
        else if (newAvgCpuUsage < ONE)
            newAvgCpuUsage = ONE;

        // sio.emit("cpuUsage", { newCpuAvg: newAvgCpuUsage });
        console.log("emitted CPU usage event for pid :" + pid + " ~ ", newAvgCpuUsage.toString() + "%");
    });
}

function runUsageMonitoring() {
 setInterval(function () {    //  call a 30s setTimeout when the loop is called
		updateUsageInfo();
		getUsage();
		console.log("Completed Usage Monetoring.");
	}, 1000)
}

function runGC() {
 setInterval(function () {    //  call a 30s setTimeout when the loop is called
		global.gc();
		console.log("Completed GC.");
	}, 30000)
}

app.listen(port);
console.log("Server listening on port " + port);
