export default {
  fetch() {
    return new Response("Shooting Master API is online", { headers: { "content-type": "text/plain" } });
  },
};
