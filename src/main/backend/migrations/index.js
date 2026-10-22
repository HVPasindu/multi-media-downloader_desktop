import { Umzug, SequelizeStorage } from 'umzug'

import * as initialSchema from './001-initial-schema.js'

export async function runMigrations(sequelize) {
  const migrator = new Umzug({
    migrations: [
      {
        name: '001-initial-schema',
        up: initialSchema.up,
        down: initialSchema.down
      }
    ],

    context: sequelize.getQueryInterface(),

    storage: new SequelizeStorage({
      sequelize: sequelize
    }),

    logger: console
  })

  // Get migrations that have not run yet
  const pending = await migrator.pending()

  console.log(
    'Pending migrations:',
    pending.map((migration) => migration.name)
  )

  // Apply only pending migrations
  await migrator.up()

  console.log('All database migrations completed')
}
