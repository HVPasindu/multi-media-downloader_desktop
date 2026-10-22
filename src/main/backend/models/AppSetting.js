import { DataTypes } from 'sequelize'

export default function defineAppSetting(sequelize) {
  return sequelize.define('AppSetting', {
    id: {
      type: DataTypes.INTEGER,
      primaryKey: true,
      autoIncrement: true
    },
    key: {
      type: DataTypes.STRING(120),
      allowNull: false,
      unique: true
    },
    value: {
      type: DataTypes.TEXT
    }
  }, {
    tableName: 'app_settings',
    timestamps: true,
    underscored: true
  })
}
