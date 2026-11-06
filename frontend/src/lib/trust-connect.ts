type Provider = { request:(args:{method:string;params?:unknown[]})=>Promise<unknown>; on?:(event:string,listener:(...args:unknown[])=>void)=>void; removeListener?:(event:string,listener:(...args:unknown[])=>void)=>void };

export async function connectTrustWalletSession(): Promise<Provider | null> {
  const projectId = import.meta.env['VITE_WALLETCONNECT_PROJECT_ID'];
  if (typeof projectId !== "string" || !projectId.trim()) return null;
  const { default: EthereumProvider } = await import("@walletconnect/ethereum-provider");
  const provider = await EthereumProvider.init({
    projectId, chains:[56], showQrModal:true,
    methods:["eth_sendTransaction","personal_sign"],
    optionalMethods:["wallet_switchEthereumChain","wallet_addEthereumChain"],
    events:["accountsChanged","chainChanged"],
    rpcMap:{56:"https://bsc-dataseed.bnbchain.org"},
    metadata:{name:"Shooting Master",description:"USDT BEP-20 withdrawal destination",url:window.location.origin,icons:[]},
  });
  await provider.connect();
  return provider as Provider;
}