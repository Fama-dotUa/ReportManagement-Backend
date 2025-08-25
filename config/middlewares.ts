export default [
	'strapi::logger',
	'strapi::errors',
	'strapi::security',
	{
		name: 'strapi::cors',
		config: {
			// Добавляем новый адрес в этот массив
			origin: ['http://26.99.75.71:5173', 'http://26.201.251.196:5173'],
			headers: '*',
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			credentials: true,
		},
	},
	'strapi::poweredBy',
	'strapi::query',
	'strapi::body',
	'strapi::session',
	'strapi::favicon',
	'strapi::public',
]
