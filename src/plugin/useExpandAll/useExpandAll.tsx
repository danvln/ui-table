import * as React from 'react'
import * as ReactTable from 'react-table'
import { ensurePluginOrder } from 'react-table'

import { TableInstance } from '../../types/Table'

const useInstance = <D extends {}>(instance: TableInstance<D>) => {
  const { data, toggleRowExpanded, expandedRows, plugins } = instance

  React.useLayoutEffect(() => {
    expandedRows.map(({ id }) => {
      return toggleRowExpanded(id as any, true)
    })
  }, [ data, toggleRowExpanded]) // eslint-disable-line

  ensurePluginOrder(plugins, ['useExpanded'], 'useExpandAll')
}

const useExpandAll = (hooks: ReactTable.Hooks<any>) => {
  hooks.useInstance.push(useInstance as any)
}

useExpandAll.pluginName = 'useExpandAll'

export default useExpandAll
