const cityInput =document.querySelector('#cityInput');
const searchBtn = document.querySelector('#searchBtn');
const cityName = document.querySelector('#cityName');
const cityTemp = document.querySelector('#temperature');
const cityCondition = document.querySelector('#weatherCondition');
const cityHumidity = document.querySelector('#humidity');
const cityWindSpeed = document.querySelector('#windSpeed');
const loadingElement = document.getElementById('loading');
const errorMessageElement = document.getElementById('error-message');
const cardElements = document.querySelectorAll('.city-card');

let controller;
const weatherWorker = new Worker('weatherWorker.js');

weatherWorker.addEventListener('message', (event) => {
    
        const sortedCities = event.data;
     sortedCities.forEach((weather, index) => {
        const card = cardElements[index];

        card.querySelector('.city-name').textContent = weather.city;
        card.querySelector('.city-temp').textContent =
            `${weather.current.temperature_2m}°C`;
    });
});

document.addEventListener('weather-updated', (event) => {
    console.log('Weather updated event received:', event.detail);
});

searchBtn.addEventListener('click', () => {
    const city = cityInput.value.trim();
    errorMessageElement.textContent = '';
    if (!city){
        errorMessageElement.textContent = 'Please enter a city name.';
        return;
    }
    loadingElement.style.display = 'block';
    fetchWeather(city);
});

cityInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        searchBtn.click();
    }
});

function fetchWeather(city){
    if (controller){
        controller.abort();
    }
    controller = new AbortController();
    const signal = controller.signal;
    const params = new URLSearchParams();
    params.set('name', city);
    params.set('count', '1');
    params.set('language', 'en');
    params.set('format', 'json');
    const baseURL = 'https://geocoding-api.open-meteo.com/v1/search';
    const url = `${baseURL}?${params.toString()}`;

    fetch(url, { signal: controller.signal })

        .then(response=>{
            if(!response.ok){
                throw new Error('Failed to fetch city data');
            }
            return response.json();
        })
        .then(data => {
        if (!data.results || data.results.length === 0) {
            throw new Error('City not found');
        }
        console.log('Search results:', data.results);
        const validCityCodes = ['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4'];

        const matchedCity = data.results.find(result =>
        result.name.toLowerCase() === city.trim().toLowerCase() &&
        validCityCodes.includes(result.feature_code)
    );

    if (!matchedCity) {
        throw new Error('City not found. Please enter a valid city name.');
    }
    const latitude = matchedCity.latitude;
    const longitude = matchedCity.longitude;
    const weatherParams = new URLSearchParams();
    weatherParams.set('latitude', latitude);
    weatherParams.set('longitude', longitude);
    weatherParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code');
    const weatherURL = `https://api.open-meteo.com/v1/forecast?${weatherParams.toString()}`;
   
    return fetch(weatherURL, { signal });
        })
        .then(response => {
           if(!response.ok){
                throw new Error('Failed to fetch weather data');
            }
            return response.json();
        })
        .then(weatherData => {
            const currentWeather = weatherData.current;
            cityName.textContent = cityInput.value.trim();
            cityTemp.textContent = `${currentWeather.temperature_2m}°C`;
            cityCondition.textContent = getWeatherCondition(currentWeather.weather_code);
            console.log('Current Weather Data:', currentWeather);
            cityHumidity.textContent = `${currentWeather.relative_humidity_2m} %`;
            cityWindSpeed.textContent = `${currentWeather.wind_speed_10m} km/h`;
            loadingElement.style.display = 'none';
        })
        .then(() => {
            cardElements.forEach(card => {
                card.style.display = 'block';
            });
        })
        .catch(error => {
            if (error.name === 'AbortError') {
                return;
            }
            loadingElement.style.display = 'none';
            errorMessageElement.textContent = error.message;
            console.error('Error fetching weather data:', error);
        });
    }

function saveToCache(key, data) {
        const cacheData = {
            data: data,
            expiry: Date.now() + 5 * 60 * 1000
        };
        localStorage.setItem(key, JSON.stringify(cacheData));
    }

function getFromCache(key) {
        const cacheData = localStorage.getItem(key);
        if (!cacheData) {
            return null;
        }
        const parsedData = JSON.parse(cacheData);
        if (Date.now() > parsedData.expiry) {
            localStorage.removeItem(key);
            return null;
        }
        return parsedData.data;
    }

async function getCityWeather(city) {
        const cacheKey = `weather_${city.toLowerCase()}`;

        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
        console.log(`${city} weather loaded from cache`);
        return cachedData;
        }

        const params = new URLSearchParams();
        params.set('name', city);
        params.set('count', '10');
        params.set('language', 'en');
        params.set('format', 'json');
        const geoURL = `https://geocoding-api.open-meteo.com/v1/search?${params.toString()}`;
        const geoResponse = await fetchWithRetry(geoURL);
        if (!geoResponse.ok) {
            throw new Error('Failed to fetch city data');
        }
        const geoData = await geoResponse.json();
        const matchedCity = geoData.results?.find(result =>result.name.toLowerCase() === city.trim().toLowerCase() &&result.feature_code?.startsWith('P'));
    
        if (!matchedCity) {
        throw new Error('City not found. Please enter a valid city name.');
        }  
        const weatherParams = new URLSearchParams();
        weatherParams.set('latitude', matchedCity.latitude);
        weatherParams.set('longitude', matchedCity.longitude);
        weatherParams.set('current', 'temperature_2m,relative_humidity_2m,wind_speed_10m,weather_code');

        const weatherURL = `https://api.open-meteo.com/v1/forecast?${weatherParams.toString()}`;
        const weatherResponse = await fetchWithRetry(weatherURL);
        if (!weatherResponse.ok) {
            throw new Error('Failed to fetch weather data');
        }
        const weatherData = await weatherResponse.json();
        const result = {
            city: city,
            current: weatherData.current
        };
        saveToCache(cacheKey, result);
        return result;
    }

async function withTimeout(promise, ms) {
    let timeoutId;

    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            reject(new Error('Request timed out'));
        }, ms);
    });
    try {
        return await Promise.race([promise, timeout]);
    } finally {
         clearTimeout(timeoutId);
    }
}

async function fetchWithRetry(url) {
    const delays = [1000, 2000, 4000];
    for (let attempt = 0; attempt <= 3; attempt++) {
        const requestController = new AbortController();
        try {
            const response = await withTimeout(
                fetch(url, { signal: requestController.signal }),
                5000
            );
            if (!response.ok) {
                throw new Error(`Request failed: ${response.status}`);
            }
            return response;
        } catch (error) {
            requestController.abort();
            if (attempt === 3) {
                throw error;
            }
            await new Promise(resolve => {
                setTimeout(resolve, delays[attempt]);
            });
        }
    }
}

async function fetchMultipleCities() {

    try {
        const cities = ['Lahore', 'Karachi', 'Islamabad'];
        const results = await Promise.all(
            cities.map(city => withTimeout(getCityWeather(city), 5000))
        );
        weatherWorker.postMessage(results);
        document.dispatchEvent(
            new CustomEvent('weather-updated', { detail: results })
        );
    results.forEach((weather, index) => {
        const card = cardElements[index];
        card.querySelector('.city-name').textContent = weather.city;
        card.querySelector('.city-temp').textContent = `${weather.current.temperature_2m}°C`;
        card.querySelector('.city-condition').textContent = getWeatherCondition(weather.current.weather_code);
        card.querySelector('.city-humidity').textContent = `${weather.current.relative_humidity_2m} %`;
        card.querySelector('.city-wind-speed').textContent = `${weather.current.wind_speed_10m} km/h`;
        card.style.display = 'block';
    });

    } catch (error) {
        console.error('Error fetching multiple cities:', error);
    }

} 

function getWeatherCondition(code){
        if (code === 0) {
            return 'Clear sky';
        }
        else if (code === 1) {
            return 'Mainly clear';
        }
        else if (code === 2) {
            return 'Partly Cloudy';
        }
       else if (code === 3) {
            return 'Overcast';
       }
       else if (code === 45 || code === 48) {
           return 'Foggy';
       }
       else if (code>=51 && code<=67) {
           return  'Rainy';
       }
       else if (code>=71 && code<=77){
           return 'Snowy'
       }
       else if (code>=80 && code<=82){
           return 'Rain showers';
       }
       else if (code>=85 && code<=86){
           return 'Snow showers';
       }
       else if (code>=95 && code<=99){
           return 'Thunderstorm';
       }
       else {
          return 'Unknown weather condition';
       }
    }   
fetchMultipleCities();