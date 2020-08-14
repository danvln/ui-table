import {
  set,
  merge,
  difference,
  get,
  isFunction,
  omit,
  lowerCase,
  deburr,
  groupBy as lodashGroupBy,
} from 'lodash'
import Papa from 'papaparse'
import * as React from 'react'
import { DropEvent, useDropzone } from 'react-dropzone'
import { useGroupBy, useExpanded } from 'react-table'
import * as ReactTable from 'react-table'

import { ActionBar, Button, notify, prompt, Text } from '@habx/ui-core'

import useRemainingActionsTime from '../_internal/useRemainingActionsTime'
import { LoadingOverlay } from '../components'
import useExpandAll from '../plugin/useExpandAll'
import Table from '../Table'
import { CellProps, Column } from '../types/Table'
import useTable from '../useTable'

import getImexColumns from './getImexColumns'
import {
  ChangedCell,
  ConfirmContainer,
  DropzoneIndicator,
  NewCell,
  OverlayContainer,
  OverlayContent,
  PrevCell,
} from './imex.style'
import { IMEXColumn } from './imex.types'
import { softCompare, readCsvFile } from './imex.utils'
import { readXLS } from './xls.utils'

export interface UseImportTableOptions<D> {
  columns: IMEXColumn<D>[]
  upsertRow: (row: D | D[]) => any
  originalData: D[]
  onFinish?: () => void
  readFile?: (file: File) => Promise<any[]>
  filterRows?: (row: D & { prevVal?: D; hasDiff?: boolean }) => boolean
  groupBy?: string
}

export interface UseImportTableParams<D> extends UseImportTableOptions<D> {
  disabled?: boolean
  accept?: string[]
  onBeforeDropAccepted?: (
    onFiles: (
      files: File[],
      options?: Partial<UseImportTableOptions<D>>
    ) => Promise<void>
  ) => (files: File[], event?: DropEvent) => Promise<void>
}

const cleanHeader = (header: string | number | {}) =>
  lowerCase(deburr(`${header}`))

const DEFAULT_ACCEPT = ['.csv', '.xls', '.xlsx']

const useImportTable = <D extends { id?: string | number }>(
  params: Partial<UseImportTableParams<D>>
) => {
  const [isParsing, setParsing] = React.useState<boolean>(false)
  const [remainingActionsState, remainingActions] = useRemainingActionsTime()

  const onFiles = React.useCallback(
    async (files: File[], options: Partial<UseImportTableOptions<D>> = {}) => {
      const {
        readFile,
        columns: _columns,
        originalData,
        onFinish,
        upsertRow,
        filterRows,
        groupBy,
      } = {
        ...params,
        ...options,
      }

      const columns = _columns as IMEXColumn<D>[]

      const remainingOriginalData = [...originalData]

      const csvColumns = getImexColumns(columns)

      const parseCsvFile = (csvData: any) => {
        const { data: _data } = Papa.parse(csvData)
        const data = _data as string[][]

        const headers = (data.shift() as string[])?.map(cleanHeader)
        const identifierColumn = csvColumns.find(
          (column) => column.meta?.csv?.identifier
        )
        if (!identifierColumn) {
          throw new Error('Missing identifier column')
        }
        const requiredColumnHeaders = csvColumns
          .filter((column) => column.meta?.csv?.required)
          .map((column) => cleanHeader(column.Header as string))

        const missingRequiredColumns = difference(
          requiredColumnHeaders as string[],
          headers
        )
        if (missingRequiredColumns.length > 0) {
          throw new Error(`${missingRequiredColumns.join(', ')} manquants`)
        }

        const ignoredColumns = []
        const orderedColumns = headers.map((header) => {
          const column = csvColumns.find(
            (csvColumn) =>
              cleanHeader(csvColumn.Header as string) === cleanHeader(header)
          )
          if (!column) {
            ignoredColumns.push(header)
          }
          return column
        })

        const parsedData = data
          .filter(
            (row: string[]) =>
              row.length === headers.length && row.some((cell) => cell.length)
          )
          .map((row: string[], rowIndex) => {
            const csvRow = row.reduce((ctx, rawCell, index) => {
              if (!orderedColumns[index]) {
                return ctx
              }
              if (
                requiredColumnHeaders.includes(
                  cleanHeader(orderedColumns[index]?.Header as string)
                ) &&
                rawCell.length === 0
              ) {
                throw new Error(
                  `${orderedColumns[index]?.Header} manquant ligne ${
                    rowIndex + 1
                  }`
                )
              }
              if (rawCell === '') {
                return ctx
              }

              const format =
                orderedColumns[index]?.meta?.csv?.format ??
                ((value: any) => `${value}`)

              let cellValue: string | number | string[] | number[]
              switch (orderedColumns[index]?.meta?.csv?.type) {
                case 'number':
                  cellValue = Number(format(rawCell.replace(',', '.')))
                  if (Number.isNaN(cellValue)) {
                    throw new Error(
                      `${orderedColumns[index]?.Header} invalide ligne ${
                        rowIndex + 1
                      }`
                    )
                  }
                  break
                case 'number[]':
                  cellValue = format(rawCell)
                    .split(',')
                    .map((value: string) => {
                      const transformedValue = Number(value)
                      if (Number.isNaN(transformedValue)) {
                        throw new Error(
                          `${orderedColumns[index]?.Header} invalide ligne ${
                            rowIndex + 1
                          }`
                        )
                      }
                      return transformedValue
                    })
                  break
                case 'string[]':
                  cellValue = format(rawCell).split(',')
                  break
                default:
                  cellValue = format(rawCell)
                  break
              }

              if (
                orderedColumns[index]?.meta?.csv?.validate &&
                !orderedColumns[index]?.meta?.csv?.validate(cellValue)
              ) {
                throw new Error(
                  `${orderedColumns[index]?.Header} invalide ligne ${
                    rowIndex + 1
                  }`
                )
              }

              return merge(
                {},
                ctx,
                set({}, orderedColumns[index]?.accessor as string, cellValue)
              )
            }, {})
            const prevValId = get(csvRow, identifierColumn.accessor as string)
            const prevValIndex = remainingOriginalData.findIndex(
              (originalRow) =>
                get(originalRow, identifierColumn.accessor as string) ===
                prevValId
            )
            const prevVal = remainingOriginalData[prevValIndex]
            remainingOriginalData.splice(prevValIndex, 1)
            const newRow = {
              ...csvRow,
              prevVal,
              hasDiff: !softCompare(csvRow, prevVal),
              id: prevVal?.id ?? undefined,
            }
            return newRow
          })
        return parsedData
      }

      const diffColumns = csvColumns.map((column) => ({
        ...column,
        Cell: ((rawProps) => {
          const props = (rawProps as unknown) as CellProps<D>
          const Cell = (isFunction(column.Cell)
            ? column.Cell
            : ({ cell }) => <div>{cell.value}</div>) as React.ComponentType<
            CellProps<D>
          >
          const cellPrevVal = get(
            rawProps.row.original?.prevVal,
            column.accessor as string
          )
          const cellPrevProps = {
            ...props,
            cell: {
              ...props.cell,
              value: cellPrevVal ?? '',
            },
          }
          // using lodash merge causes performance issues

          if (cellPrevVal === undefined) {
            return (
              <NewCell>
                <Cell {...props} />
              </NewCell>
            )
          }

          if (
            props.cell.value === undefined ||
            softCompare(cellPrevVal, props.cell.value)
          ) {
            return <Cell {...cellPrevProps} />
          }

          return (
            <div>
              <ChangedCell>
                <Cell {...props} />
              </ChangedCell>
              <PrevCell>
                <Cell {...cellPrevProps} />
              </PrevCell>
            </div>
          )
        }) as ReactTable.Renderer<
          CellProps<D & { prevVal: D; hasDiff: boolean }>
        >,
      }))

      try {
        setParsing(true)

        const file = files[0]
        let rawCsvData
        if (readFile) {
          rawCsvData = await readFile(file)
        } else if (file.type.includes('text/csv')) {
          rawCsvData = await readCsvFile(file)
        } else {
          rawCsvData = await readXLS(file)
        }

        const parsedData = ((parseCsvFile(rawCsvData) as unknown) as (D & {
          hasDiff: boolean
        })[]).filter((csvRow) =>
          filterRows ? filterRows(csvRow) : csvRow.hasDiff
        )
        setParsing(false)
        if (parsedData.length === 0) {
          notify('Aucune difference avec les données actuelles')
          return
        }
        const plugins = groupBy ? [useGroupBy, useExpanded, useExpandAll] : []
        const hasConfirmed = await prompt(({ onResolve }) => ({
          fullscreen: true,
          Component: () => {
            const tableInstance = useTable<D>(
              {
                columns: diffColumns as Column<D>[],
                data: parsedData as (D & { id?: string })[],
                initialState: {
                  groupBy: [groupBy as string],
                },
              },
              ...plugins
            )
            return (
              <ConfirmContainer>
                <Table style={{ scrollable: true }} instance={tableInstance} />
                <ActionBar>
                  <Button warning onClick={() => onResolve(false)}>
                    Annuler
                  </Button>
                  <Button onClick={() => onResolve(true)}>Valider</Button>
                </ActionBar>
              </ConfirmContainer>
            )
          },
        }))
        if (hasConfirmed) {
          remainingActions.initLoading()
          const cleanData = parsedData.map(
            (row) => (omit(row, ['prevVal', 'hasDiff']) as unknown) as D
          )
          const dataToUpsert = groupBy
            ? Object.values(lodashGroupBy(cleanData, groupBy))
            : cleanData
          remainingActions.setActionsCount(dataToUpsert.length)

          for (const data of dataToUpsert) {
            upsertRow && (await upsertRow(data))
            remainingActions.onActionDone()
          }
          notify({
            title: 'Import terminé',
            description: `${dataToUpsert.length} ligne(s) importée(s)`,
          })
          if (isFunction(onFinish)) {
            onFinish()
          }
        }
      } catch (e) {
        console.error(e) // eslint-disable-line
        remainingActions.onError()
        setParsing(false)
        notify(e.toString())
        return
      }
    },
    // @ts-ignore
    [remainingActions, ...Object.values(params)] // eslint-disable-line
    // options object in "onFiles" function is overwriting params so we need all params
    // However, the params object will change at each render and
    // we want shallow compare of each property of params without spreading it outside of the function
    // so we can't forgot any props
  )

  const onDropRejected = React.useCallback(
    () => notify('Type de fichier non supporté'),
    []
  )

  const onDropAccepted = React.useCallback(
    (files: File[], event?: DropEvent) =>
      params.onBeforeDropAccepted
        ? params.onBeforeDropAccepted(onFiles)(files, event)
        : onFiles(files),
    [onFiles, params.onBeforeDropAccepted] // eslint-disable-line
  )
  const dropzone = useDropzone({
    accept: DEFAULT_ACCEPT,
    onDropAccepted,
    onDropRejected,
  })

  const overlays = (
    <React.Fragment>
      {isParsing && (
        <OverlayContainer>
          <OverlayContent>
            <Text>Analyse en cours...</Text>
          </OverlayContent>
        </OverlayContainer>
      )}
      {remainingActionsState.loading && (
        <LoadingOverlay
          total={remainingActionsState.total}
          done={remainingActionsState.done}
          remainingTime={remainingActionsState.remainingTime}
        />
      )}
      {dropzone.isDragActive && (
        <DropzoneIndicator>
          <OverlayContent>
            <Text>Importer</Text>
          </OverlayContent>
        </DropzoneIndicator>
      )}
    </React.Fragment>
  )

  const dropzoneProps = React.useMemo(
    () =>
      params.disabled
        ? {}
        : omit(dropzone.getRootProps(), ['onClick, onBlur', 'onFocus']),
    [dropzone, params.disabled]
  )

  return {
    overlays,
    dropzoneProps,
    dropzone,
    onFiles,
    onDropAccepted,
    onDropRejected,
    accept: DEFAULT_ACCEPT,
    uploading: remainingActionsState.loading,
    parsing: isParsing,
    totalRows: remainingActionsState.total,
    updatedRows: remainingActionsState.done,
    remainingTime: remainingActionsState.remainingTime,
  }
}

export default useImportTable
