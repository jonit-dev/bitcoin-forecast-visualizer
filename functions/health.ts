const jsonHeaders = {
  'content-type': 'application/json; charset=utf-8',
  'access-control-allow-origin': '*',
};

export async function onRequestGet() {
  return Response.json({ ok: true }, { headers: jsonHeaders });
}
