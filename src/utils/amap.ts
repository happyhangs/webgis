const KEY = 'fcfdf69df521f74f022e6cc53cb1d8b9';

export async function geocodeAmap(address: string): Promise<{ lat: number; lng: number; name: string } | null> {
  const resp = await fetch(
    `https://restapi.amap.com/v3/geocode/geo?key=${KEY}&address=${encodeURIComponent(address)}`,
  );
  const data = await resp.json();
  if (data.status !== '1' || !data.geocodes?.length) return null;
  const [lng, lat] = data.geocodes[0].location.split(',').map(Number);
  return { lat, lng, name: data.geocodes[0].formatted_address || address };
}
