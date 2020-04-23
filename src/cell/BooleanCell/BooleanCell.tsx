import * as React from 'react'

import { palette } from '@habx/ui-core'

import IconCell, { IconCellProps } from '../IconCell'

const BooleanCell = React.forwardRef<HTMLDivElement, BooleanCellProps>(
  (props, ref) => {
    const { value, ...rest } = props

    return (
      <IconCell
        ref={ref}
        icon={value ? 'check' : 'close'}
        color={value ? palette.green[600] : palette.orange[400]}
        {...rest}
      />
    )
  }
)

interface BooleanCellProps extends Omit<IconCellProps, 'icon' | 'color'> {
  value: boolean
}

export default BooleanCell
