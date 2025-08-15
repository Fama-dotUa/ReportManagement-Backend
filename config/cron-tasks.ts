module.exports = {
	'*/0 * * * *': async ({ strapi }) => {
		console.log('CRON JOB: Проверка просроченных заявок на обучение...')

		const threeDaysAgo = new Date()
		threeDaysAgo.setDate(threeDaysAgo.getDate() - 3)

		const expiredRequests = await strapi.entityService.findMany(
			'api::training-request.training-request',
			{
				filters: {
					status_request: { $eq: 'рассматривается' },
					createdAt: { $lt: threeDaysAgo.toISOString() },
				},
				populate: ['position', 'applicant'],
			}
		)

		if (expiredRequests.length === 0) {
			console.log('CRON JOB: Просроченных заявок не найдено.')
			return
		}

		console.log(
			`CRON JOB: Найдено ${expiredRequests.length} просроченных заявок.`
		)

		const instructors = await strapi.entityService.findMany(
			'plugin::users-permissions.user',
			{
				filters: {
					positions: {
						name: { $eq: 'Инструктор' },
					},
				},

				fields: ['id', 'username', 'CR'],
			}
		)

		if (instructors.length === 0) {
			console.log('CRON JOB: Инструкторы для штрафа не найдены.')
			for (const request of expiredRequests) {
				await strapi.entityService.update(
					'api::training-request.training-request',
					request.id,
					{
						data: { status_request: 'халтура начальства' },
					}
				)
			}
			return
		}

		for (const request of expiredRequests) {
			const position = request.position
			if (!position || !position.CR) continue

			const penalty = Math.floor(position.CR * 0.2)
			if (penalty <= 0) continue

			console.log(
				`CRON JOB: Штраф за заявку #${request.id} составляет ${penalty} CR.`
			)

			for (const instructor of instructors) {
				const currentCR = Number(instructor.CR) || 0

				const newCR = currentCR - penalty

				await strapi.entityService.update(
					'plugin::users-permissions.user',
					instructor.id,
					{
						data: {
							CR: newCR,
						},
					}
				)
				console.log(
					`CRON JOB: Пользователь ${instructor.username} оштрафован. Новый баланс: ${newCR} CR.`
				)
			}

			await strapi.entityService.update(
				'api::training-request.training-request',
				request.id,
				{
					data: { status_request: 'халтура начальства' },
				}
			)
		}

		console.log('CRON JOB: Работа по просроченным заявкам завершена.')
	},
}
