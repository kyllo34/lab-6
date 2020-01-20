'use strict';
// load environment variables from the .env file
require('dotenv').config();

// app dependencies
const express = require('express');
const superagent = require('superagent');
const cors = require('cors');
const pg = require('pg');

// app setup
const PORT = process.env.PORT || 3001;
const app = express();
app.use(cors());

// Database Connection Setup
const client = new pg.Client(process.env.DATABASE_URL);
client.on('error', err => {throw err;});

// Route Definitions
app.get('/location', locationHandler);
app.get('/weather', weatherHandler);
app.get('/events', eventfulHandler);
app.get('/movies', moviesHandler);
app.get('/yelp', yelpHandler);
app.use('*', (request, response ) => response.status(404).send('Page not found!'));
app.use(errorHandler);


// Route Handlers
function locationHandler(request, response) {
  let city = request.query.city;
  getLocationData(city)
    .then(data => render(data, response))
    .catch((error) => errorHandler(error, request, response));
}

function getLocationData(city, response) {
  let sql = 'SELECT * FROM locations WHERE search_query = $1;';
  let values = [city];
  return client.query(sql, values)
    .then(data => {
      if (data.rowCount) {response.status(200).send(data.rows[0]) }
      else {
        console.log('hello');

        let key = process.env.LOCATION_IQ_API_KEY;
        const url = `https://us1.locationiq.com/v1/search.php?key=${key}&q=${city}&format=json`;
        return superagent.get(url)
          .then(results => {
            cacheLocation(city, results.body)});
      }
    });
}
function cacheLocation(city, data) {
  let location = new Location(city, data[0]);
  let sql = 'INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4)';
  let safeValues = [city, location.formatted_query, location.latitude, location.longitude];
  return client.query(sql, safeValues)
    .then(results => results.rows[0]);
}


function weatherHandler(request, response) {
  let latitude = request.query.latitude;
  let longitude = request.query.longitude;
  let sql = `SELECT * FROM forecasts WHERE latitude=$1 AND longitude=$2;`;
  let values = [latitude, longitude];
  client.query(sql, values)
    .then(data => {
      if (data.rowCount) {
        response.status(200).json(data.rows[0].forecast);
      } else {
        let key = process.env.DARKSKY_API_KEY;
        const url = `https://api.darksky.net/forecast/${key}/${latitude},${longitude}`
        superagent.get(url)
          .then(dataSet => {
            let forecastData = dataSet.body.daily.data;
            let localForecast = forecastData.map(day => new DailySummary(day));
            let forecastjson = JSON.stringify(localForecast);
            let sql2 = `INSERT INTO forecasts (latitude, longitude, forecast) VALUES ($1, $2, $3);`;
            let values2 = [latitude, longitude, forecastjson];
            client.query(sql2, values2);
            response.status(200).send(localForecast);
          })
          .catch(() => errorHandler('Something went wrong', response));
      }
    })
}

function eventfulHandler(request, response) {
  let key = process.env.EVENTFUL_API_KEY;
  let {search_query} = request.query;
  const eventDataUrl = `http://api.eventful.com/json/events/search?keywords=music&location=${search_query}&app_key=${key}`;
  superagent.get(eventDataUrl)
    .then(eventData => {
      let eventMassData = JSON.parse(eventData.text);
      let localEvent = eventMassData.events.event.map(thisEventData => {
        return new Event(thisEventData);
      })
      response.status(200).send(localEvent);
    })
    .catch(err => console.error('Something went wrong', err));
}

function moviesHandler(request, response) {
  let key = process.env.TMDB_API_KEY;
  let {search_query} = request.query;
  let movieDataUrl = `https://api.themoviedb.org/3/search/movie?api_key=${key}&language=en-US&query=${search_query}`;
  superagent.get(movieDataUrl)
    .then(movieData => {
      let movieList = movieData.body.results;
      let movie = movieList.map(thisMovieData => {
        return new Movie(thisMovieData);
      })
      response.status(200).send(movie);
    })
    .catch(err => console.error('Something went wrong', err));
}
function yelpHandler(request, response) {
  let key = process.env.YELP_API_KEY;
  let {latitude, longitude} = request.query;
  let yelpDataUrl = `https://api.yelp.com/v3/businesses/search?term=delis&latitude=${latitude}&longitude=${longitude}`;
  superagent
    .get(yelpDataUrl)
    .set('Authorization', `Bearer ${key}`)
    .then(yelpData => {
      let businessList = JSON.parse(yelpData.text).businesses;
      let business = businessList.map(thisBusinessData => {
        return new Business(thisBusinessData);
      })
      response.status(200).send(business);
    })
    .catch(err => console.error('Something went wrong', err));
}

function render(data, response) {
  response.status(200).json(data);
}

// Constructors
function Location(city, locationData) {
  this.search_query = city;
  this.formatted_query = locationData.display_name;
  this.latitude = locationData.lat;
  this.longitude = locationData.lon;
}
function DailySummary(day) {
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toString().slice(0,15);
}
function Event(thisEventData) {
  this.name = thisEventData.title;
  this.event_date = thisEventData.start_time.slice(0, 10);
  this.link = thisEventData.url;
  this.summary = thisEventData.description;
}
function Movie(thisMovieData) {
  this.title = thisMovieData.title;
  this.overview = thisMovieData.overview;
  this.average_votes = thisMovieData.vote_average;
  this.total_votes = thisMovieData.vote_count;
  this.image_url = `https://image.tmdb.org/t/p/w500${thisMovieData.backdrop_path}`;
  this.popularity = thisMovieData.popularity;
  this.released_on = thisMovieData.release_date;
}

function Business(thisBusinessData) {
  this.name = thisBusinessData.name;
  this.image_url = thisBusinessData.image_url;
  this.price = thisBusinessData.price;
  this.url = thisBusinessData.url;
}

// Error Handlers
function errorHandler(error, request, response) {
  response.status(500).send(error);
}


// Connect to DB and Start the Web Server
client.connect()
  .then( () => {
    app.listen(PORT, () => {
      console.log('Server up on', PORT);
    });
  })
  .catch(err => {
    throw `PG Startup Error: ${err.message}`;
  })
