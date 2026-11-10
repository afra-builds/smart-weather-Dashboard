self.addEventListener('message', (event) => {
    const weatherData = event.data
    const sortedCities = [...weatherData].sort((a, b) =>
    a.current.temperature_2m - b.current.temperature_2m
    );
    self.postMessage(sortedCities);
});