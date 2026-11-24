// Legacy demo links now use the shared server-backed site.
const view=new URL(location.href).searchParams.get('view');
location.replace(new URL(view==='request'?'./':'./admin/',location.href));
