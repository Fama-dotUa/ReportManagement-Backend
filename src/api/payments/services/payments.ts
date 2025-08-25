// src/api/payments/services/payments.ts
type CheckParams = { code: string; windowHours?: number; timeoutMs?: number }
const PAYMENT_UID = 'api::credited-payment.credited-payment'
const USER_UID = 'plugin::users-permissions.user'
// какое поле хранит баланс у пользователя
const CR_ATTR = 'CR'
// Нормализация: A-Z0-9 + маппинг кириллицы на похожие латинские символы
function normalizeAZ09(input: string): string {
	const s = String(input ?? '').toUpperCase()
	const map: Record<string, string> = {
		А: 'A',
		В: 'B',
		С: 'C',
		Е: 'E',
		Н: 'H',
		К: 'K',
		М: 'M',
		О: 'O',
		Р: 'P',
		Т: 'T',
		Х: 'X',
		І: 'I',
	}
	const mapped = s.replace(/[АВСЕНКМОРТХІ]/g, ch => map[ch] || ch)
	return mapped.replace(/[^A-Z0-9]+/g, '')
}
export async function creditOnce(opts: {
	txId: string
	userId: number
	amountKop: number
	creditedCr: number
	code?: string
	accountId?: string
	txTime?: number
}) {
	const { txId, userId, amountKop, creditedCr, code, accountId, txTime } = opts

	return await strapi.db.connection.transaction(async trx => {
		const exists = await strapi.db.query(PAYMENT_UID).findOne({
			where: { txId },
			select: ['id'],
		})
		if (exists) {
			return { created: false, duplicated: true }
		}

		try {
			await strapi.db.query(PAYMENT_UID).create({
				data: {
					txId,
					code,
					amountKop,
					creditedCr,
					accountId,
					txTime: txTime ?? Date.now(),
					users_permissions_user: userId,
				},
			})

			const userModel = strapi.getModel(USER_UID)
			const USERS_TABLE =
				(userModel as any).tableName || (userModel as any).collectionName

			await trx(USERS_TABLE)
				.where({ id: userId })
				.increment(CR_ATTR, creditedCr)

			return { created: true, duplicated: false }
		} catch (e: any) {
			if (
				e?.code === 'ER_DUP_ENTRY' ||
				e?.message?.toLowerCase?.().includes('unique')
			) {
				return { created: false, duplicated: true }
			}
			throw e
		}
	})
}
// безопасный fetch с таймаутом
async function safeFetch(
	url: string,
	opts: RequestInit & { timeoutMs?: number } = {}
) {
	const controller = new AbortController()
	const timer = setTimeout(
		() => controller.abort('timeout'),
		opts.timeoutMs ?? 15000
	)
	try {
		const res = await fetch(url, { ...opts, signal: controller.signal })
		const ct = res.headers.get('content-type') || ''
		const text = await res.text()
		return { res, ct, text }
	} finally {
		clearTimeout(timer)
	}
}

// Собираем ВСЕ id счетов: UAH-аккаунты + jars (если есть)
async function getAllCandidateIds(token: string): Promise<string[]> {
	try {
		const { res, ct, text } = await safeFetch(
			'https://api.monobank.ua/personal/client-info',
			{
				headers: { 'X-Token': token, Accept: 'application/json' },
				timeoutMs: 12000,
			}
		)
		if (!res.ok || !ct.includes('application/json')) return ['0']
		const info = JSON.parse(text)

		const ids: string[] = []
		if (Array.isArray(info?.accounts)) {
			for (const a of info.accounts) {
				if (a?.currencyCode === 980 && a?.id) ids.push(String(a.id))
			}
		}
		if (Array.isArray(info?.jars)) {
			for (const j of info.jars) {
				if (j?.id) ids.push(String(j.id))
				if (j?.sendId) ids.push(String(j.sendId))
			}
		}

		const uniq = Array.from(new Set(ids))
		return uniq.length ? uniq : ['0']
	} catch {
		return ['0']
	}
}

export default () => ({
	async checkByCodeSafe({ code, windowHours, timeoutMs = 15000 }: CheckParams) {
		// 1) Токен
		const token = process.env.MONOBANK_TOKEN?.trim()
		if (!token) return { found: false, reason: 'MONOBANK_TOKEN не задан' }

		// 2) Код: нормализовать и проверить формат A-Z0-9 длиной 6
		const codeNorm = normalizeAZ09(code)
		if (!/^[A-Z0-9]{6}$/.test(codeNorm)) {
			return {
				found: false,
				reason: 'Код должен быть 6 символов (буквы/цифры)',
			}
		}

		// 3) Интервал
		const hours = 120
		const to = Math.floor(Date.now() / 1000)
		const from = to - hours * 3600
		console.log("Проверка кода '%s' за последние %d часов", codeNorm, hours)
		console.log('Тайм-аут запросов к Monobank: %d мс', timeoutMs)

		const accountIds = await getAllCandidateIds(token)

		let match: any | null = null
		let usedAccount: string | null = null

		for (const accId of accountIds) {
			const { res, ct, text } = await safeFetch(
				`https://api.monobank.ua/personal/statement/${accId}/${from}/${to}`,
				{ headers: { 'X-Token': token, Accept: 'application/json' }, timeoutMs }
			)

			if (!res.ok) continue // пробуем следующий счёт
			if (!ct.includes('application/json')) continue

			let txs: any[]
			try {
				txs = JSON.parse(text)
			} catch {
				continue
			}
			if (!Array.isArray(txs)) continue

			const found = txs
				.filter(tx => tx && typeof tx === 'object')
				.filter(tx => {
					const tNorm = normalizeAZ09(
						`${tx?.comment ?? ''} ${tx?.description ?? ''}`
					)
					return tNorm.includes(codeNorm)
				})
				// Хотим самую новую
				.sort((a, b) => (a?.time ?? 0) - (b?.time ?? 0))
				.pop()

			if (found) {
				match = found
				usedAccount = accId
				break
			}
		}
		if (!match) {
			return { found: false, reason: 'Оплату с таким кодом не нашли' }
		}

		const amountKop = Math.max(0, Number(match.amount * -1) || 0)
		const creditedCr = Math.floor(amountKop / 10)

		const userModel = strapi.getModel('plugin::users-permissions.user') as any

		// поле кода пользователя (у тебя оно называется unique_code)
		const codeAttr = 'unique_code' as const

		const crAttr: 'CR' | 'cr' | null = userModel?.attributes?.CR
			? 'CR'
			: userModel?.attributes?.cr
				? 'cr'
				: null

		// формируем select ТОЛЬКО из строк
		const select: string[] = ['id', codeAttr]
		if (crAttr) select.push(crAttr)

		// ИЩЕМ пользователя по коду (если у тебя есть codeNorm — можешь подставить его)
		const user = await strapi.db
			.query('plugin::users-permissions.user')
			.findOne({
				where: { [codeAttr]: code }, // <-- ВАЖНО: ключ — строка, не объект
				select,
			})

		if (!user) {
			return {
				found: true,
				txId: match?.id ?? null,
				amountKop,
				creditedCr: 0,
				reason: 'Платёж найден, но пользователь по коду не найден',
			}
		}

		if (!crAttr) {
			return {
				found: true,
				txId: match?.id ?? null,
				userId: user.id,
				amountKop,
				creditedCr: 0,
				reason: 'У модели пользователя нет поля CR/cr',
			}
		}
		const res = await creditOnce({
			txId: String(match.id), // уникальный ID транзакции от банка
			userId: user.id,
			amountKop,
			creditedCr,
			code,
			txTime: Number(match.time) || Date.now(),
		})

		return {
			found: true,
			txId: String(match.id),
			userId: user.id,
			amountKop,
			creditedCr,
			credited: res.created, // true если реально зачислили
			duplicate: res.duplicated, // true если платёж уже был
		}
	},
})
