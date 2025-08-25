import { env } from 'process'

// src/api/payments/controllers/payments.ts
export default {
	async check(ctx) {
		ctx.set('Content-Type', 'application/json')

		const code = String(ctx.request.body?.code ?? '').trim()
		try {
			const result = await strapi
				.service('api::payments.payments')
				.checkByCodeSafe({ code })
			ctx.status = 200
			ctx.body = result // {found, txId?, reason?}
		} catch (e: any) {
			// на всякий случай: преобразуем ЛЮБУЮ ошибку в JSON
			ctx.status = 200
			ctx.body = { found: false, reason: e?.message || 'Internal error' }
		}
	},

	// Быстрый тест токена, чтобы исключить 403 Unknown 'X-Token'
	async ping(ctx) {
		ctx.set('Content-Type', 'application/json')
		try {
			const token = env.MONOBANK_TOKEN
			if (!token)
				return (ctx.body = { ok: false, reason: 'MONOBANK_TOKEN не задан' })

			const r = await fetch('https://api.monobank.ua/personal/client-info', {
				headers: { 'X-Token': token, Accept: 'application/json' },
			})
			const text = await r.text()
			if (!r.ok)
				return (ctx.body = {
					ok: false,
					reason: `HTTP ${r.status}: ${text.slice(0, 200)}…`,
				})
			if (!r.headers.get('content-type')?.includes('application/json'))
				return (ctx.body = { ok: false, reason: 'Ожидался JSON от Monobank' })

			const info = JSON.parse(text)
			ctx.body = {
				ok: true,
				tail: token.slice(-4),
				client: { name: info?.name ?? null },
			}
		} catch (e: any) {
			ctx.body = { ok: false, reason: e?.message || 'Ошибка' }
		}
	},
}
