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
const weatherWorker = new Worker('weatherWorker.js');

weatherWorker.addEventListener('message', (event) => {
      document.dispatchEvent(
        new CustomEvent('weather-updated',{detail: event.data})
      );
    });   
document.addEventListener('weather-updated', (event) => {
    const sortedCities = event.detail;
    cardElements.forEach((card, index) => {
    const weather =sortedCities[index];
        
        if (!weather) {card.style.display='none';return;
        }
        card.querySelector('.city-name').textContent = weather.city;
        card.querySelector('.city-temp').textContent = `${weather.current.temperature_2m}°C`;
        card.querySelector('.city-condition').textContent = getWeatherCondition(weather.current.weather_code);
        card.querySelector('.city-humidity').textContent = `${weather.current.relative_humidity_2m} %`;
        card.querySelector('.city-wind-speed').textContent = `${weather.current.wind_speed_10m} km/h`;
        card.style.display = 'block';
    });
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
   getCityWeather(city)
   .then(weather => {
    const currentWeather =weather.current;
        cityName.textContent = weather.city;
        cityTemp.textContent = `${currentWeather.temperature_2m}°C`;
        cityCondition.textContent = getWeatherCondition(currentWeather.weather_code);
        cityHumidity.textContent = `${currentWeather.relative_humidity_2m} %`;
        cityWindSpeed.textContent = `${currentWeather.wind_speed_10m} km/h`;
        loadingElement.style.display = 'none';
    })
    .catch(error => {
        if (error.name === 'AbortError') {
            loadingElement.style.display = 'none';
         return;
        } 
        loadingElement.style.display = 'none';

        errorMessageElement.textContent = error.message;   
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
    try {
        const cacheData = localStorage.getItem(key);
        if (!cacheData) {
            return null;
        }
        const parsedData = JSON.parse(cacheData);
        if (Date.now() >= parsedData.expiry) {
            localStorage.removeItem(key);
            return null;
        }
        return parsedData.data;
    } catch (error) {
        return null;
    }
}

async function getCityWeather(city) {
        const cacheKey = `weather_${city.toLowerCase()}`;

        const cachedData = getFromCache(cacheKey);
        if (cachedData) {
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
        const matchedCity = geoData.results?.find(result =>
            result.name.toLowerCase() === city.trim().toLowerCase() &&
            ['PPLC', 'PPLA', 'PPLA2', 'PPLA3', 'PPLA4'].includes(result.feature_code)
        );
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

async function withTimeout(promise, ms, controller) {
    let timeoutId;
    const timeout = new Promise((resolve, reject) => {
        timeoutId = setTimeout(() => {
            controller.abort();
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
                5000,
                requestController
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
   loadingElement.style.display = 'block';
   errorMessageElement.textContent = '';

    try {
        const cities = ['Lahore', 'Karachi', 'Islamabad'];
        const results = await Promise.allSettled(
            cities.map(city => getCityWeather(city))
        );
       const successfulCities = results

            .filter(result => result.status === 'fulfilled')
            .map(result => result.value);
        const failedCities = results

        .map((result, index) => { 
            if(result.status === 'rejected') {
                return `${cities[index]}: ${result.reason.message}`;
            }
            return null;
        })

        .filter(error => error !== null);
        if(failedCities.length>0){
              errorMessageElement.textContent = `Some cities could not load: ${failedCities.join(';')}`;
            }

         if (successfulCities.length > 0) {
                weatherWorker.postMessage(successfulCities);
            }

         if (successfulCities.length === 0) {
                errorMessageElement.textContent ='Weather data could not be loaded for any city.';
                cardElements.forEach(card => {
                    card.style.display = 'none';
                });
            }

        }finally{
              loadingElement.style.display = 'none';
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