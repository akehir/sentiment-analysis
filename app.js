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
   console.log("No VCAP Services!");
}


var myDb;
var mongoConnection = mongoClient.connect(mongo.url, function(err, db) {
  if(!err) {
    console.log("Connection to mongoDB established");
    myDb = db;

    getInitialResults();
    setInterval(function(){
    		checkAnalyzingCollection();
		},  1000);

  } else {
  	console.log("Failed to connect to database!");
  }
});


//REST
app.get('/xyz', function (req, res) {
	/*
		xyz
	*/

	
});



function getInitialResults() {
	var resultCollection = myDb.collection(dbResultsCollection);
	resultCollection.find().toArray(function(err, docs) {
		if (docs.length > 0) {
			for (var i = 0; i < docs.length; i++) {
				var entry = docs[i];
				results[phrase] = 
					{
						phrase: entry.phrase,
						tweets: entry.tweets,
						totalsentiment: entry.totalsentiment,
						score: entry.score,
						history: entry.history
					};
			}
		} else {
			console.log("No results in database!");
		}
	});

	console.log(results);
}

function checkAnalyzingCollection() {
	// Check MongoDB Analyzing Collection
	var collection = myDb.collection(dbAnalyzingCollection);
	collection.find().toArray(function(err, docs) {
		if (docs.length > 0) {
			for (var i = 0; i < docs.length; i++) {
				sentiment(docs.text, function (err, result) {
							console.log("Tweet: " + docs.text + " --- Result: " + result.score);
							collection.remove({_id: docs._id});

							var sentiment = results[docs.phrase];
							sentiment.totalsentiment += result.score;
							sentiment.tweets++;
			 
							// Calculate average
							var average = sentiment.totalsentiment / sentiment.tweets;

							// Limit average to bounds
							if (average > averageUpperBound) average = averageUpperBound;
							if (average < averageLowerBound) average = averageLowerBound;
							
							// Map average to score between 0 and 1
							sentiment.score = ((average - averageLowerBound) / (averageUpperBound - averageLowerBound)) * (scoreUpperBound - scoreLowerBound) + scoreLowerBound;

							results[docs.phrase] = sentiment;
							// tweetCount++;
							// tweetTotalSentiment += result.score;
						});
			}

			console.log(results);
	    } else {
	    	console.log("No new tweets in database!");
	    }
	  });
}


app.listen(port);
console.log("Server listening on port " + port);
