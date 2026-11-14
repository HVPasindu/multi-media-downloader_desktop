import { DataTypes } from 'sequelize'

export async function up({ context: queryInterface }) {
  const table = await queryInterface.describeTable('download_jobs')

  if (!table.total_bytes) {
    await queryInterface.addColumn('download_jobs', 'total_bytes', {
      type: DataTypes.BIGINT,
      allowNull: true
    })
  }

  if (!table.total_bytes_is_estimate) {
    await queryInterface.addColumn('download_jobs', 'total_bytes_is_estimate', {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false
    })
  }
}

export async function down({ context: queryInterface }) {
  const table = await queryInterface.describeTable('download_jobs')

  if (table.total_bytes_is_estimate) {
    await queryInterface.removeColumn('download_jobs', 'total_bytes_is_estimate')
  }

  if (table.total_bytes) {
    await queryInterface.removeColumn('download_jobs', 'total_bytes')
  }
}
