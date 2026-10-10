import React, { useEffect, useRef, useState } from 'react';

export default function MapLocationPicker({ onLocationSelected, initialAddress }) {
  const mapRef = useRef(null);
  const [map, setMap] = useState(null);
  const [marker, setMarker] = useState(null);
  const [addressLoading, setAddressLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [suggestions, setSuggestions] = useState([]);
  const searchTimeout = useRef(null);

  useEffect(() => {
    if (!mapRef.current) return;
    if (typeof window === 'undefined' || !window.L) {
      console.error("Leaflet not loaded yet.");
      return;
    }
    
    try {
      // Initialize map
      const initialCoords = [11.1271, 78.6569]; // Default: Tamil Nadu
      const leafletMap = window.L.map(mapRef.current).setView(initialCoords, 7);
      
      window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(leafletMap);

      const initialMarker = window.L.marker(initialCoords, { draggable: true }).addTo(leafletMap);
      setMarker(initialMarker);
      setMap(leafletMap);
      
      // Try to get user's location
      leafletMap.locate({ setView: true, maxZoom: 14 });
      leafletMap.on('locationfound', (e) => {
        initialMarker.setLatLng(e.latlng);
        fetchAddress(e.latlng.lat, e.latlng.lng);
      });

      leafletMap.on('click', (e) => {
        initialMarker.setLatLng(e.latlng);
        fetchAddress(e.latlng.lat, e.latlng.lng);
      });
      
      initialMarker.on('dragend', (e) => {
        const position = initialMarker.getLatLng();
        fetchAddress(position.lat, position.lng);
      });
    } catch (e) {
      console.error("Error initializing MapLocationPicker:", e);
    }
  }, []);

  const fetchAddress = async (lat, lng) => {
    setAddressLoading(true);
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await response.json();
      if (data && data.address) {
        setSearchQuery(data.display_name || "");
        onLocationSelected({
          lat,
          lng,
          addressLine1: data.address.road || data.address.suburb || "",
          city: data.address.city || data.address.town || data.address.county || "",
          state: data.address.state || "",
          pincode: data.address.postcode || "",
          fullAddress: data.display_name
        });
      }
    } catch (error) {
      console.error("Error fetching address", error);
    } finally {
      setAddressLoading(false);
    }
  };

  const handleSearch = (query) => {
    setSearchQuery(query);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    
    if (query.length < 3) {
      setSuggestions([]);
      return;
    }
    
    searchTimeout.current = setTimeout(async () => {
      try {
        const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=5&countrycodes=in`);
        const data = await res.json();
        setSuggestions(data);
      } catch (e) {
        console.error(e);
      }
    }, 400);
  };

  const executeSearchForTopResult = async (query) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=1&countrycodes=in`);
      const data = await res.json();
      if (data && data.length > 0) {
        handleSelectSuggestion(data[0]);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault(); // Prevent form submission
      if (suggestions.length > 0) {
        handleSelectSuggestion(suggestions[0]);
      } else if (searchQuery.length >= 3) {
        executeSearchForTopResult(searchQuery);
      }
    }
  };

  const handleSelectSuggestion = (place) => {
    setSearchQuery(place.display_name);
    setSuggestions([]);
    
    const lat = parseFloat(place.lat);
    const lon = parseFloat(place.lon);
    
    if (map && marker) {
      map.setView([lat, lon], 16);
      marker.setLatLng([lat, lon]);
    }

    const addr = place.address || {};
    onLocationSelected({
      lat,
      lng: lon,
      addressLine1: addr.road || addr.suburb || place.name || "",
      city: addr.city || addr.town || addr.county || "",
      state: addr.state || "",
      pincode: addr.postcode || "",
      fullAddress: place.display_name
    });
  };

  return (
    <div className="w-full">
      <div className="relative mb-3">
        <input 
          type="text" 
          value={searchQuery}
          onChange={(e) => handleSearch(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Type an address or pincode and press Enter..." 
          className="w-full bg-input-background border border-border rounded-lg px-4 py-2.5 text-sm outline-none focus:border-accent"
        />
        {suggestions.length > 0 && (
          <div className="absolute z-10 w-full mt-1 bg-card border border-border rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
            {suggestions.map((s, i) => (
              <div 
                key={i} 
                onClick={() => handleSelectSuggestion(s)}
                className="px-4 py-3 text-sm hover:bg-muted cursor-pointer border-b border-border last:border-0"
              >
                {s.display_name}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs text-muted-foreground">Or click on the map / drag the pin to select your exact location.</p>
        <button 
          type="button" 
          onClick={() => {
            if (map) {
              setAddressLoading(true);
              map.locate({ setView: true, maxZoom: 16 });
            }
          }}
          className="text-xs flex items-center gap-1 font-semibold text-accent hover:underline bg-accent/10 px-2 py-1 rounded"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
          Use Current Location
        </button>
      </div>
      <div ref={mapRef} style={{ height: '300px', width: '100%', borderRadius: '8px', zIndex: 0 }} />
      {addressLoading && <p className="text-xs text-accent mt-2 animate-pulse">Fetching address for this location...</p>}
    </div>
  );
}
