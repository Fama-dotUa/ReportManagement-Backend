export default {
	routes: [
		{
			method: 'POST',
			path: '/payments/check',
			handler: 'payments.check',
			config: { auth: false },
		},
		{
			method: 'GET',
			path: '/payments/mono/ping',
			handler: 'payments.ping',
			config: { auth: false },
		},
	],
}
