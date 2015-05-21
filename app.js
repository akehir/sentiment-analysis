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


//Analysis
setInterval(function(){

	// Check MongoDB Analyzing Collection
	var collection = myDb.collection(dbAnalyzingCollection);
	collection.find().toArray(function(err, docs) {
		if (docs.length > 0) {
			for (var i = 0; i < docs.length; i++) {
				sentiment(docs.text, function (err, result) {
							console.log("Tweet: " + docs.text + " --- Result: " + result.score);

							collection.remove({_id: docs._id});
							// tweetCount++;
							// tweetTotalSentiment += result.score;
						});
			}
	    } else {
	    	console.log("No new tweets in database!");
	    }
	  });

},  1000);


app.listen(port);
console.log("Server listening on port " + port);
