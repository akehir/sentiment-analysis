var port = (process.env.VCAP_APP_PORT || 3000);
var express = require("express");
var sentiment = require('sentiment');
var mongoClient = require("mongodb").MongoClient;

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



var results = {};
var averageUpperBound =  1.3;
var averageLowerBound = -1.3;
var scoreUpperBound   =  1.0;
var scoreLowerBound   =  0.0;


// Database Connection
var mongo = {};
var dbResultsCollection		= "results";
var dbAnalyzingCollection	= "analyzing";
var dbKeywordsCollection	= "keywords";


if (process.env.VCAP_SERVICES) {
    var env = JSON.parse(process.env.VCAP_SERVICES);

    if (env['mongodb-2.4']) {
        mongo['url'] = env['mongodb-2.4'][0]['credentials']['url'];
    } 

    console.log("Mongo URL:" + mongo.url);
} else {
	mongo['url'] = "mongodb://localhost:27017/ase";
   console.log("No VCAP Services!");
}


var myDb;
var mongoConnection = mongoClient.connect(mongo.url, function(err, db) {
  if(!err) {
    console.log("Connection to mongoDB established");
    myDb = db;

    checkAnalyzingCollection();

  } else {
  	console.log("Failed to connect to database!");
  }
});


function checkAnalyzingCollection() {
	var analyzingCollection = myDb.collection(dbAnalyzingCollection);
	var resultsCollection = myDb.collection(dbResultsCollection);
    setTimeout(function () {    //  call a 3s setTimeout when the loop is called
    	analyzingCollection.find().toArray(function(err, docs) {
    		if (docs.length > 0) {
    			analyzingCollection.remove();
    			console.log("Batch Size: " + docs.length);
    			for (var i = 0; i < docs.length; i++) {
    				var entry = docs[i];
    				sentiment(entry.text, function (err, results) {
    					var result = {
    						phrase: entry.phrase,
    						text: entry.text,
    						date: entry.date,
    						sentiment: results.score
    					};
    					resultsCollection.insert(result);
    				});
    			}
    		} else {
    			console.log("No new tweets in database!");
    		}
    	});


        checkAnalyzingCollection();
   	}, 1000)
}

app.listen(port);
console.log("Server listening on port " + port);
