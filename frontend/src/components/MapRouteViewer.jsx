import React, { useEffect, useRef } from 'react';

export default function MapRouteViewer({ destinationAddress }) {
  const mapRef = useRef(null);

  useEffect(() => {
    if (!mapRef.current || !destinationAddress) return;

    // We'll clear the container in case of re-renders
    mapRef.current.innerHTML = "<div id='route-map' style='height: 100%; width: 100%; border-radius: 8px;'></div>";
    
    if (typeof window === 'undefined' || !window.L) {
      console.error("Leaflet not loaded yet.");
      return;
    }
    
    let leafletMap;
    try {
      leafletMap = window.L.map('route-map').setView([11.1271, 78.6569], 7);
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(leafletMap);
    } catch (e) {
      console.error("Error initializing MapRouteViewer:", e);
      return;
    }

    const findAndRoute = async () => {
      try {
        // Try to get provider's location via geolocation
        navigator.geolocation.getCurrentPosition(async (position) => {
          const providerLat = position.coords.latitude;
          const providerLng = position.coords.longitude;

          // Geocode the destination address
          const destRes = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(destinationAddress)}`);
          const destData = await destRes.json();
          
          if (destData && destData.length > 0) {
            const destLat = parseFloat(destData[0].lat);
            const destLng = parseFloat(destData[0].lon);

            // Add routing machine
            window.L.Routing.control({
              waypoints: [
                window.L.latLng(providerLat, providerLng),
                window.L.latLng(destLat, destLng)
              ],
              routeWhileDragging: false,
              showAlternatives: false,
              addWaypoints: false,
              fitSelectedRoutes: true,
              show: true
            }).addTo(leafletMap);
          } else {
            console.error("Could not find destination address:", destinationAddress);
          }
        }, () => {
          console.error("Provider denied geolocation or it failed.");
        });
      } catch (e) {
        console.error("Routing error:", e);
      }
    };

    findAndRoute();

    return () => {
      if (leafletMap) {
        leafletMap.remove();
      }
    };
  }, [destinationAddress]);

  return (
    <div className="w-full h-64 relative border border-border rounded-lg overflow-hidden">
      <div ref={mapRef} style={{ width: '100%', height: '100%' }}></div>
    </div>
  );
}
